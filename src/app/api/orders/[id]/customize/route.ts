import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { OrderStatus, ListingStatus } from '@/lib/status';
import { validateOrderItems, getMealPeriod, OrderItems } from '@/lib/menu';
import { notify } from '@/lib/notify';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order, error: fetchErr } = await admin
      .from('orders').select('*').eq('id', id).single();
    if (fetchErr || !order)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.buyer_id !== u.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (order.status !== OrderStatus.LOCKED)
      return NextResponse.json({ error: `Cannot customize order in status ${order.status}` }, { status: 400 });

    const period = getMealPeriod();
    if (period === 'closed')
      return NextResponse.json({ error: 'Ortega is currently closed' }, { status: 400 });

    let body: OrderItems;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const v = validateOrderItems(body, period);
    if (!v.ok)
      return NextResponse.json({ error: v.errors[0], errors: v.errors }, { status: 422 });

    // Update order atomically
    const { error: updateErr } = await admin.from('orders').update({
      order_items: body,
      status:      OrderStatus.BUYER_SUBMITTED,
      updated_at:  new Date().toISOString(),
    }).eq('id', id);

    if (updateErr) {
      console.error('[customize] DB update failed:', updateErr);
      if (updateErr.message.includes('order_items') || updateErr.code === '42703')
        return NextResponse.json({ error: 'Failed to save order — schema issue. Contact support.' }, { status: 500 });
      if (updateErr.message.includes('orders_status_ck') || updateErr.code === '23514')
        return NextResponse.json({ error: 'Failed to save order — status constraint. Contact support.' }, { status: 500 });
      return NextResponse.json({ error: 'Failed to save order' }, { status: 500 });
    }

    // Belt-and-suspenders: verify write landed
    const { data: after } = await admin.from('orders')
      .select('status, order_items').eq('id', id).single();
    if (after?.status !== OrderStatus.BUYER_SUBMITTED) {
      console.error('[customize] status did not advance:', after);
      return NextResponse.json({ error: 'Order did not advance — DB constraint issue. Contact support.' }, { status: 500 });
    }

    // Advance listing to IN_PROGRESS (prevents lock-expiry sweep from reopening it)
    const { error: listingErr } = await admin.from('listings')
      .update({ status: ListingStatus.IN_PROGRESS })
      .eq('id', order.listing_id)
      .eq('status', ListingStatus.LOCKED); // only advance if still LOCKED
    if (listingErr) {
      console.error('[customize] listing IN_PROGRESS update failed (non-fatal):', listingErr);
    }

    await notify(order.seller_id, 'buyer_submitted', '🍽️ Buyer chose their meal',
      'Review their selection and accept the order.', `/orders/${id}`);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[customize] unexpected error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
