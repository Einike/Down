import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { ListingStatus } from '@/lib/status';
import { auditLog } from '@/lib/audit';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: l, error: fetchErr } = await admin
      .from('listings').select('seller_id,status').eq('id', id).single();
    if (fetchErr || !l) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (l.seller_id !== u.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if ([ListingStatus.COMPLETED, ListingStatus.CANCELLED, ListingStatus.EXPIRED].includes(l.status as any))
      return NextResponse.json({ error: 'Cannot cancel this listing' }, { status: 400 });

    // Check no active order is using this listing
    const { data: activeOrders } = await admin.from('orders')
      .select('id,status').eq('listing_id', id)
      .in('status', ['LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED'])
      .limit(1);
    if (activeOrders?.length)
      return NextResponse.json({ error: 'Cannot cancel — an active order exists for this listing' }, { status: 409 });

    const { error: updateErr } = await admin.from('listings')
      .update({ status: ListingStatus.CANCELLED }).eq('id', id);
    if (updateErr) {
      console.error('[listing.delete]', updateErr);
      return NextResponse.json({ error: `Failed to cancel listing: ${updateErr.message}` }, { status: 500 });
    }

    await auditLog(u.id, 'listing.cancel', 'listing', id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
