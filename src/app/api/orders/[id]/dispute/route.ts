import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { OrderStatus } from '@/lib/status';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/audit';

// POST — seller reports payment not received / issue with payment.
// Moves PAYMENT_SENT → DISPUTED, creates a moderation report, notifies both parties.
// Only callable from PAYMENT_SENT state by the seller.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order, error: fetchErr } = await admin
      .from('orders').select('*').eq('id', id).single();
    if (fetchErr || !order)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.seller_id !== u.id)
      return NextResponse.json({ error: 'Only the seller can flag a payment issue' }, { status: 403 });
    if (order.status !== OrderStatus.PAYMENT_SENT)
      return NextResponse.json(
        { error: `Cannot dispute from status ${order.status}` },
        { status: 400 },
      );

    // Optional message from seller
    let sellerNote = 'Seller reported payment not received.';
    try {
      const body = await req.json();
      if (typeof body.note === 'string' && body.note.trim().length >= 5)
        sellerNote = body.note.trim().slice(0, 500);
    } catch { /* no body is fine */ }

    // Optimistic lock — only update if status is STILL PAYMENT_SENT.
    // Prevents race with concurrent payment-confirm calls.
    const { data: updated, error: updateErr } = await admin.from('orders').update({
      status:     OrderStatus.DISPUTED,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('status', OrderStatus.PAYMENT_SENT).select('id');

    if (updateErr) {
      console.error('[dispute] DB update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to dispute order' }, { status: 500 });
    }
    if (!updated?.length)
      return NextResponse.json({ error: 'Order status changed — refresh and try again' }, { status: 409 });

    // Create a moderation report automatically (non-fatal if it fails)
    const { error: reportErr } = await admin.from('reports').insert({
      reporter_id:       u.id,
      reported_user_id:  order.buyer_id,
      order_id:          id,
      reason_code:       'scam_suspicious',
      message:           `Payment dispute — seller did not receive payment. Note: ${sellerNote}`,
      status:            'open',
    });
    if (reportErr) console.error('[dispute] report insert failed (non-fatal):', reportErr);

    await auditLog(u.id, 'order.disputed', 'order', id, { note: sellerNote });

    await Promise.all([
      // Buyer: let them know the seller flagged an issue
      notify(
        order.buyer_id,
        'order_disputed',
        '⚠️ Payment issue flagged',
        'The seller reported they did not receive your payment. Please use the chat to resolve this, or contact support.',
        `/orders/${id}`,
      ),
      // Seller: confirm the dispute was logged
      notify(
        order.seller_id,
        'order_disputed',
        '⚠️ Dispute logged',
        'We\'ve flagged this order for review. The QR step remains locked. You can still cancel if needed.',
        `/orders/${id}`,
      ),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[dispute] unexpected error:', e);
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
