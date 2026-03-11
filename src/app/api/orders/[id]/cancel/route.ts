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

    const { data: order, error: fetchErr } = await admin
      .from('orders').select('*').eq('id', id).single();
    if (fetchErr || !order)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (order.buyer_id !== u.id && order.seller_id !== u.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if ([OrderStatus.COMPLETED, OrderStatus.CANCELLED].includes(order.status as any))
      return NextResponse.json({ error: 'Cannot cancel at this stage' }, { status: 400 });

    // Optional cancel reason — cancellation proceeds even if body is absent or empty
    let cancel_reason_code: string | null = null;
    let cancel_reason_text: string | null = null;
    try {
      const body = await req.json();
      if (typeof body.cancel_reason_code === 'string' && body.cancel_reason_code.trim())
        cancel_reason_code = body.cancel_reason_code.trim();
      if (typeof body.cancel_reason_text === 'string' && body.cancel_reason_text.trim())
        cancel_reason_text = body.cancel_reason_text.trim().slice(0, 500);
    } catch { /* no body is fine */ }

    // Core update — optional reason fields only sent when present
    const updatePayload: Record<string, unknown> = {
      status:       OrderStatus.CANCELLED,
      updated_at:   new Date().toISOString(),
      cancelled_by: u.id,
    };
    if (cancel_reason_code) updatePayload.cancel_reason_code = cancel_reason_code;
    if (cancel_reason_text) updatePayload.cancel_reason_text = cancel_reason_text;

    const { error: orderErr } = await admin.from('orders')
      .update(updatePayload)
      .eq('id', id);
    if (orderErr) {
      console.error('[cancel] order update failed:', orderErr);
      return NextResponse.json({ error: `Failed to cancel order: ${orderErr.message}` }, { status: 500 });
    }

    // ── Listing restore logic ────────────────────────────────────────────────
    // Fetch listing to check its expiry window
    const { data: listing } = await admin
      .from('listings')
      .select('expires_at, status')
      .eq('id', order.listing_id)
      .single();

    const now       = new Date();
    const expired   = !listing || new Date(listing.expires_at) <= now;
    const isBuyer   = u.id === order.buyer_id;

    // Re-open rules:
    //  • Listing still has time left AND cancel happened before seller invested effort
    //    (LOCKED or BUYER_SUBMITTED) → re-open so another buyer can claim it
    //  • Listing expired → mark EXPIRED so it no longer shows on the board
    //  • Seller cancelled at SELLER_ACCEPTED or later, OR listing expired → CANCELLED
    const earlyStage = [OrderStatus.LOCKED, OrderStatus.BUYER_SUBMITTED].includes(order.status as any);
    let listingNextStatus: string;
    let listingPatch: Record<string, unknown>;

    if (!expired && earlyStage) {
      listingNextStatus = ListingStatus.OPEN;
      listingPatch = { status: ListingStatus.OPEN, locked_by: null, lock_until: null };
    } else if (expired) {
      listingNextStatus = ListingStatus.EXPIRED;
      listingPatch = { status: ListingStatus.EXPIRED };
    } else {
      // Late-stage cancel (SELLER_ACCEPTED / QR_UPLOADED) — seller put in real effort;
      // don't auto-re-list without seller deciding to post again.
      listingNextStatus = ListingStatus.CANCELLED;
      listingPatch = { status: ListingStatus.CANCELLED };
    }

    const { error: listingErr } = await admin.from('listings')
      .update(listingPatch)
      .eq('id', order.listing_id);
    if (listingErr) {
      // Non-fatal — order is cancelled; log but don't fail the response
      console.error('[cancel] listing update failed (non-fatal):', listingErr);
    }

    await auditLog(u.id, 'order.cancel', 'order', id, {
      was_status:    order.status,
      listing_next:  listingNextStatus,
      cancel_reason: cancel_reason_code,
    });

    const other    = isBuyer ? order.seller_id : order.buyer_id;
    const isSeller = !isBuyer;

    const notifPromises: Promise<unknown>[] = [
      notify(
        other, 'order_cancelled', '❌ Order cancelled',
        isSeller ? 'The seller cancelled this order.' : 'The buyer cancelled this order.',
        `/orders/${id}`,
      ),
    ];

    // Notify seller when their listing is re-opened so they know it's live again
    if (listingNextStatus === ListingStatus.OPEN && isBuyer) {
      notifPromises.push(
        notify(
          order.seller_id, 'listing_reopened', '🔄 Listing back on board',
          'The buyer cancelled — your listing is live again and available for others to claim.',
          `/listings/${order.listing_id}`,
        ),
      );
    }

    await Promise.all(notifPromises);

    // Tell the client whether the listing was re-opened (so the buyer can be
    // redirected to the board to see it available again, if they want)
    return NextResponse.json({
      ok:               true,
      listing_reopened: listingNextStatus === ListingStatus.OPEN,
    });
  } catch (e: any) {
    console.error('[cancel] unexpected error:', e);
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
