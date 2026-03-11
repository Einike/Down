import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';

// GET /api/profile/reputation
// Returns the logged-in user's seller stats: avg rating, review count,
// completed sale count, and up to 5 recent written reviews with buyer usernames.
// All aggregation happens server-side — no schema changes required.
export async function GET(req: NextRequest) {
  try {
    const u = await requireUser(req);

    // Run both queries in parallel — reviews and completed-order count.
    const [reviewResult, completedResult] = await Promise.all([
      admin
        .from('reviews')
        .select('rating, body, created_at, buyer_id')
        .eq('seller_id', u.id)
        .order('created_at', { ascending: false }),
      admin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', u.id)
        .eq('status', 'COMPLETED'),
    ]);

    if (reviewResult.error) {
      console.error('[reputation] reviews query failed:', reviewResult.error);
      return NextResponse.json({ error: 'Failed to load reputation' }, { status: 500 });
    }

    const allReviews     = reviewResult.data ?? [];
    const reviewCount    = allReviews.length;
    const completedCount = completedResult.count ?? 0;

    const avgRating = reviewCount > 0
      ? Math.round((allReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
      : null;

    // Only surface reviews that have written text for the "recent feedback" section.
    const writtenRecent = allReviews.filter(r => r.body).slice(0, 5);

    // Resolve buyer usernames for those reviews (same map pattern as /api/listings).
    let buyerMap: Record<string, string> = {};
    if (writtenRecent.length > 0) {
      const buyerIds = [...new Set(writtenRecent.map(r => r.buyer_id))];
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, username')
        .in('id', buyerIds);
      buyerMap = Object.fromEntries(
        (profiles ?? []).map((p: any) => [p.id, p.username ?? 'buyer']),
      );
    }

    const recentReviews = writtenRecent.map(r => ({
      rating:         r.rating,
      body:           r.body,
      created_at:     r.created_at,
      buyer_username: buyerMap[r.buyer_id] ?? 'buyer',
    }));

    return NextResponse.json({
      reputation: {
        avg_rating:      avgRating,
        review_count:    reviewCount,
        completed_count: completedCount,
        recent_reviews:  recentReviews,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}
