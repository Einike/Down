import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { ACTIVE_LISTING_STATUSES, ListingStatus } from '@/lib/status';

export async function GET(req: NextRequest) {
  try {
    const u   = await requireUser(req);
    const now = new Date().toISOString();
    await admin.from('listings').update({ status: ListingStatus.EXPIRED })
      .eq('seller_id', u.id).in('status', [ListingStatus.OPEN, ListingStatus.LOCKED]).lt('expires_at', now);
    // NOTE: no expires_at filter here.  The auto-expire block above already
    // converted any stale OPEN/LOCKED listings to EXPIRED, so the only
    // remaining ACTIVE listings are either still-valid OPEN/LOCKED ones or
    // IN_PROGRESS listings (which may legitimately outlive their expires_at
    // if the order takes longer than the original listing window).
    const { data } = await admin.from('listings')
      .select('id,status,expires_at,price_cents,created_at')
      .eq('seller_id', u.id)
      .in('status', ACTIVE_LISTING_STATUSES)
      .order('created_at', { ascending: false }).limit(1);
    return NextResponse.json({ listings: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
