import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { OrderStatus, ListingStatus } from '@/lib/status';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/audit';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order, error: fetchErr } = await admin.from('orders').select('*').eq('id', id).single();
    if (fetchErr || !order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (order.buyer_id !== u.id) return NextResponse.json({ error: 'Only buyer can complete' }, { status: 403 });
    if (order.status !== OrderStatus.QR_UPLOADED)
      return NextResponse.json({ error: `Cannot complete order in status ${order.status}` }, { status: 400 });

    const { error: updateErr } = await admin.from('orders')
      .update({ status: OrderStatus.COMPLETED, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateErr) {
      console.error('[complete] DB update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to complete order' }, { status: 500 });
    }

    const { error: listingErr } = await admin.from('listings')
      .update({ status: ListingStatus.COMPLETED, completed_at: new Date().toISOString() })
      .eq('id', order.listing_id);
    if (listingErr) {
      console.error('[complete] listing update failed (non-fatal):', listingErr);
      // Non-fatal: order is already marked complete
    }

    await auditLog(u.id, 'order.complete', 'order', id);
    // Notify both parties
    await Promise.all([
      notify(order.seller_id, 'order_completed', '🎉 Sale complete!',
        'Buyer confirmed pickup. Transaction done!', `/orders/${id}`),
      notify(order.buyer_id, 'order_completed', '✅ Pickup confirmed!',
        'Thanks for using GauchoGrub. Leave a review if you\'d like.', `/orders/${id}`),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
