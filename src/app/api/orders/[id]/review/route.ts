import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { OrderStatus } from '@/lib/status';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/audit';

// POST /api/orders/[id]/review — buyer submits a 1-5 star review after pickup
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order, error: fetchErr } = await admin
      .from('orders').select('*').eq('id', id).single();
    if (fetchErr || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.buyer_id !== u.id)
      return NextResponse.json({ error: 'Only the buyer can leave a review' }, { status: 403 });
    if (order.status !== OrderStatus.COMPLETED)
      return NextResponse.json({ error: 'Reviews are only allowed on completed orders' }, { status: 400 });

    let body: { rating: unknown; body?: unknown };
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const { rating, body: reviewBody } = body;
    if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5)
      return NextResponse.json({ error: 'Rating must be an integer from 1 to 5' }, { status: 422 });

    const bodyText = typeof reviewBody === 'string' ? reviewBody.trim() : '';
    if (bodyText.length > 1000)
      return NextResponse.json({ error: 'Review text must be 1000 characters or fewer' }, { status: 422 });

    const { error: insertErr } = await admin.from('reviews').insert({
      order_id:  id,
      seller_id: order.seller_id,
      buyer_id:  u.id,
      rating,
      body: bodyText || null,
    });

    if (insertErr) {
      if (insertErr.code === '23505')
        return NextResponse.json({ error: 'You have already reviewed this order' }, { status: 409 });
      console.error('[review.post]', insertErr);
      return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 });
    }

    await auditLog(u.id, 'review.create', 'order', id, { rating });
    await notify(
      order.seller_id, 'review_received', '⭐ New review',
      `You received a ${rating}-star review.`, `/orders/${id}`,
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// GET /api/orders/[id]/review — returns the review for this order (null if none yet)
// Accessible by both buyer and seller of the order.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order } = await admin
      .from('orders').select('buyer_id,seller_id').eq('id', id).single();
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.buyer_id !== u.id && order.seller_id !== u.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await admin
      .from('reviews')
      .select('id,rating,body,created_at')
      .eq('order_id', id)
      .maybeSingle();

    if (error) {
      console.error('[review.get]', error);
      return NextResponse.json({ error: 'Failed to fetch review' }, { status: 500 });
    }
    return NextResponse.json({ review: data ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
