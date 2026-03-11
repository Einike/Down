import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { ListingStatus, ACTIVE_LISTING_STATUSES, SELLER_COOLDOWN_MS } from '@/lib/status';
import { ortegaClosedReason } from '@/lib/ortegaHours';
import { auditLog } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const now = new Date().toISOString();

    // Auto-expire stale locks ONLY when no active order exists
    // (prevents reopening a listing that's IN_PROGRESS)
    const { data: lockedListings } = await admin.from('listings')
      .select('id,lock_until')
      .eq('status', ListingStatus.LOCKED)
      .lt('lock_until', now);

    if (lockedListings?.length) {
      for (const l of lockedListings) {
        // Check if any active order references this listing
        const { data: activeOrders } = await admin.from('orders')
          .select('id')
          .eq('listing_id', l.id)
          .in('status', ['LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED'])
          .limit(1);

        if (!activeOrders?.length) {
          await admin.from('listings')
            .update({ status: ListingStatus.OPEN, locked_by: null, lock_until: null })
            .eq('id', l.id);
        }
      }
    }

    const { data: rows, error } = await admin
      .from('listings')
      .select('id,seller_id,price_cents,expires_at,status,created_at,tags')
      .eq('status', ListingStatus.OPEN)
      .gt('expires_at', now)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: 'Failed to load listings' }, { status: 500 });

    const sellerIds = [...new Set((rows ?? []).map((r: any) => r.seller_id))];
    let sellerMap:  Record<string, string> = {};
    let repMap:     Record<string, { avg_rating: number; review_count: number }> = {};

    if (sellerIds.length) {
      // Fetch profiles and reviews in parallel — same seller IDs, one round-trip each.
      const [profilesRes, reviewsRes] = await Promise.all([
        admin.from('profiles').select('id,username').in('id', sellerIds),
        admin.from('reviews').select('seller_id,rating').in('seller_id', sellerIds),
      ]);

      sellerMap = Object.fromEntries(
        (profilesRes.data ?? []).map((p: any) => [p.id, p.username ?? 'seller']),
      );

      // Aggregate ratings per seller in JS — avoids a GROUP BY on the DB side.
      const ratingsBySeller: Record<string, number[]> = {};
      for (const r of reviewsRes.data ?? []) {
        (ratingsBySeller[r.seller_id] ??= []).push(r.rating);
      }
      for (const [sid, ratings] of Object.entries(ratingsBySeller)) {
        repMap[sid] = {
          review_count: ratings.length,
          avg_rating:   Math.round(ratings.reduce((s, v) => s + v, 0) / ratings.length * 10) / 10,
        };
      }
    }

    return NextResponse.json({
      listings: (rows ?? []).map((x: any) => ({
        ...x,
        seller_username:     sellerMap[x.seller_id] ?? 'seller',
        seller_avg_rating:   repMap[x.seller_id]?.avg_rating   ?? null,
        seller_review_count: repMap[x.seller_id]?.review_count ?? 0,
      })),
    }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const u = await requireUser(req);

    // Hours gate
    const closed = ortegaClosedReason();
    if (closed) return NextResponse.json({ error: closed }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { price_cents, expires_at } = body;

    if (price_cents == null || !expires_at)
      return NextResponse.json({ error: 'price_cents and expires_at are required' }, { status: 400 });
    if (typeof price_cents !== 'number' || price_cents < 0 || price_cents > 600)
      return NextResponse.json({ error: 'Price must be $0–$6.00' }, { status: 400 });
    if (new Date(expires_at) <= new Date())
      return NextResponse.json({ error: 'expires_at must be in the future' }, { status: 400 });

    const nowIso = new Date().toISOString();

    // Auto-expire stale listings for this seller
    await admin.from('listings')
      .update({ status: ListingStatus.EXPIRED })
      .eq('seller_id', u.id)
      .in('status', [ListingStatus.OPEN, ListingStatus.LOCKED])
      .lt('expires_at', nowIso);

    // Active listing guard
    const { data: active } = await admin.from('listings')
      .select('id,expires_at')
      .eq('seller_id', u.id)
      .in('status', ACTIVE_LISTING_STATUSES)
      .gt('expires_at', nowIso)
      .limit(1);
    if (active?.length)
      return NextResponse.json({
        error: 'You already have an active listing',
        active_listing_id:  active[0].id,
        active_expires_at:  active[0].expires_at,
      }, { status: 409 });

    // Seller cooldown — query by completed_at (when the sale finished), not created_at
    const cooldownAfter = new Date(Date.now() - SELLER_COOLDOWN_MS).toISOString();
    const { data: recent } = await admin.from('listings')
      .select('completed_at,updated_at')
      .eq('seller_id', u.id)
      .eq('status', ListingStatus.COMPLETED)
      .not('completed_at', 'is', null)
      .gt('completed_at', cooldownAfter)
      .order('completed_at', { ascending: false })
      .limit(1);

    if (recent?.length) {
      const completedAt = recent[0].completed_at!;
      const remainingMs = new Date(completedAt).getTime() + SELLER_COOLDOWN_MS - Date.now();
      const wait = Math.ceil(remainingMs / 60_000);
      return NextResponse.json({
        error: `Cooldown active — please wait ${wait} more min before posting again`,
        cooldown_ends_at: new Date(new Date(completedAt).getTime() + SELLER_COOLDOWN_MS).toISOString(),
      }, { status: 429 });
    }

    const { data, error } = await admin.from('listings').insert([{
      seller_id:          u.id,
      dining_location:    'Ortega',
      price_cents,
      status:             ListingStatus.OPEN,
      expires_at,
      pickup_start:       nowIso,
      pickup_end:         expires_at,
      available_quantity: 1,
      quantity_remaining: 1,
      fee_cents:          0,
      total_cents:        price_cents,
      tags:               [],
    }]).select().single();

    if (error) {
      if (error.message.includes('listings_one_active_per_seller'))
        return NextResponse.json({ error: 'You already have an active listing' }, { status: 409 });
      console.error('[listing.create]', error);
      return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 });
    }

    await auditLog(u.id, 'listing.create', 'listing', data.id, { price_cents });
    return NextResponse.json({ listing: data }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}
