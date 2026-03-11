import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { OrderStatus } from '@/lib/status';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/audit';

// POST — seller confirms payment received.
// Moves PAYMENT_SENT → PAYMENT_CONFIRMED, unlocking the QR upload step.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order, error: fetchErr } = await admin
      .from('orders').select('*').eq('id', id).single();
    if (fetchErr || !order)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.seller_id !== u.id)
      return NextResponse.json({ error: 'Only the seller can confirm payment' }, { status: 403 });
    if (order.status !== OrderStatus.PAYMENT_SENT)
      return NextResponse.json(
        { error: `Cannot confirm payment from status ${order.status}` },
        { status: 400 },
      );

    const { error: updateErr } = await admin.from('orders').update({
      status:               OrderStatus.PAYMENT_CONFIRMED,
      payment_confirmed_at: new Date().toISOString(),
      updated_at:           new Date().toISOString(),
    }).eq('id', id);

    if (updateErr) {
      console.error('[payment-confirm] DB update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 });
    }

    await auditLog(u.id, 'order.payment_confirmed', 'order', id);

    // Tell buyer their payment was confirmed and the QR is coming
    await notify(
      order.buyer_id,
      'payment_confirmed',
      '✅ Payment confirmed!',
      'The seller confirmed they received your payment. They are now preparing the QR code — hang tight!',
      `/orders/${id}`,
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[payment-confirm] unexpected error:', e);
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
