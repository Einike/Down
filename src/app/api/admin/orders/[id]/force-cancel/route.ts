import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';
import { admin } from '@/lib/supabaseAdmin';
import { auditLog } from '@/lib/audit';
import { notify } from '@/lib/notify';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor  = await requireAdmin(req);
    const { id } = await ctx.params;
    const body   = await req.json().catch(() => ({}));
    const reason = (body.reason as string) || 'Cancelled by admin';

    const { data: order, error: fetchErr } = await admin
      .from('orders').select('*').eq('id', id).single();
    if (fetchErr || !order)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (['COMPLETED', 'CANCELLED'].includes(order.status))
      return NextResponse.json({ error: `Order is already ${order.status}` }, { status: 400 });

    const { error: orderErr } = await admin.from('orders')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', id);
    if (orderErr)
      return NextResponse.json({ error: 'Failed to cancel order' }, { status: 500 });

    // Restore listing — check expiry first (same logic as user cancel route)
    const { data: listing } = await admin
      .from('listings')
      .select('expires_at')
      .eq('id', order.listing_id)
      .single();

    const expired = !listing || new Date(listing.expires_at) <= new Date();
    const listingPatch = expired
      ? { status: 'EXPIRED' }
      : { status: 'OPEN', locked_by: null, lock_until: null };

    await admin.from('listings')
      .update(listingPatch)
      .eq('id', order.listing_id)
      .in('status', ['LOCKED', 'IN_PROGRESS', 'OPEN', 'CANCELLED']);

    await auditLog(actor.id, 'admin.force_cancel', 'order', id, {
      reason,
      prev_status:      order.status,
      listing_restored: !expired,
    });

    await Promise.all([
      notify(order.buyer_id,  'order_cancelled', '❌ Order cancelled by admin', reason, `/orders/${id}`),
      notify(order.seller_id, 'order_cancelled', '❌ Order cancelled by admin', reason, `/orders/${id}`),
    ]);

    return NextResponse.json({ ok: true, listing_restored: !expired });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
