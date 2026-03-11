import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';
import { admin } from '@/lib/supabaseAdmin';
import { SELLER_COOLDOWN_MS } from '@/lib/status';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const now  = new Date();
    const s24h = new Date(now.getTime() - 86_400_000).toISOString();
    const s7d  = new Date(now.getTime() - 7  * 86_400_000).toISOString();
    const s14d = new Date(now.getTime() - 14 * 86_400_000).toISOString();

    const [auditRes, listingsRes, ordersRes, notifsRes, profilesRes] = await Promise.all([
      admin.from('audit_log')
        .select('id,action,entity_type,entity_id,metadata,created_at,user_id')
        .order('created_at', { ascending: false }).limit(200),
      admin.from('listings')
        .select('id,status,seller_id,price_cents,created_at,completed_at,expires_at,updated_at')
        .order('created_at', { ascending: false }).limit(2000),
      admin.from('orders')
        .select('id,status,buyer_id,seller_id,amount_cents,created_at,updated_at,listing_id,order_items,lock_expires_at')
        .order('created_at', { ascending: false }).limit(2000),
      admin.from('notifications')
        .select('id,user_id,type,read_at,created_at').gte('created_at', s7d),
      admin.from('profiles').select('id,username,email,created_at').limit(2000),
    ]);

    const listings  = listingsRes.data  ?? [];
    const orders    = ordersRes.data    ?? [];
    const notifs    = notifsRes.data    ?? [];
    const profiles  = profilesRes.data  ?? [];
    const auditLogs = auditRes.data     ?? [];

    // User lookup map
    const userMap: Record<string, string> = {};
    for (const p of profiles) userMap[p.id] = p.username ?? p.email ?? p.id.slice(0, 8);

    // Listing breakdown
    const listingStats = {
      total:       listings.length,
      open:        listings.filter(l => l.status === 'OPEN').length,
      locked:      listings.filter(l => l.status === 'LOCKED').length,
      in_progress: listings.filter(l => l.status === 'IN_PROGRESS').length,
      completed:   listings.filter(l => l.status === 'COMPLETED').length,
      cancelled:   listings.filter(l => l.status === 'CANCELLED').length,
      expired:     listings.filter(l => l.status === 'EXPIRED').length,
    };

    // Order breakdown
    const orderStats = {
      total:           orders.length,
      locked:          orders.filter(o => o.status === 'LOCKED').length,
      buyer_submitted: orders.filter(o => o.status === 'BUYER_SUBMITTED').length,
      seller_accepted: orders.filter(o => o.status === 'SELLER_ACCEPTED').length,
      qr_uploaded:     orders.filter(o => o.status === 'QR_UPLOADED').length,
      completed:       orders.filter(o => o.status === 'COMPLETED').length,
      cancelled:       orders.filter(o => o.status === 'CANCELLED').length,
    };

    const completed      = orders.filter(o => o.status === 'COMPLETED');
    const totalRevenue   = completed.reduce((s, o) => s + (o.amount_cents ?? 0), 0);
    const avgOrder       = completed.length > 0 ? Math.round(totalRevenue / completed.length) : 0;
    const conversionRate = orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0;

    // 24h activity
    const activity24h = {
      new_listings: listings.filter(l => l.created_at > s24h).length,
      new_orders:   orders.filter(o => o.created_at > s24h).length,
      completions:  completed.filter(o => (o.updated_at ?? o.created_at) > s24h).length,
    };

    // ── Health checks ──────────────────────────────────────────────
    const healthChecks: { label: string; status: 'ok' | 'warn' | 'error'; detail: string }[] = [];

    // Stuck orders: LOCKED with expired lock_expires_at
    const stuckLocked = orders.filter(o =>
      o.status === 'LOCKED' && o.lock_expires_at && new Date(o.lock_expires_at) < now
    );
    healthChecks.push({
      label:  'Expired lock orders',
      status: stuckLocked.length === 0 ? 'ok' : 'warn',
      detail: stuckLocked.length === 0
        ? 'No orders stuck in expired locks'
        : `${stuckLocked.length} order(s) locked past expiry — will self-heal on next board fetch`,
    });

    // Orders advanced past LOCKED without order_items
    const missingItems = orders.filter(o =>
      ['BUYER_SUBMITTED', 'SELLER_ACCEPTED', 'QR_UPLOADED'].includes(o.status) && !o.order_items
    );
    healthChecks.push({
      label:  'Missing meal data',
      status: missingItems.length === 0 ? 'ok' : 'error',
      detail: missingItems.length === 0
        ? 'All active orders have meal data'
        : `${missingItems.length} order(s) advanced past LOCKED without order_items — schema issue`,
    });

    // Orders stuck at BUYER_SUBMITTED for >2 hours (seller unresponsive)
    const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000).toISOString();
    const staleBuyerSubmitted = orders.filter(o =>
      o.status === 'BUYER_SUBMITTED' && o.updated_at < twoHoursAgo
    );
    healthChecks.push({
      label:  'Seller response time',
      status: staleBuyerSubmitted.length === 0 ? 'ok' : 'warn',
      detail: staleBuyerSubmitted.length === 0
        ? 'All submitted orders have seller responses within 2h'
        : `${staleBuyerSubmitted.length} order(s) waiting on seller for >2 hours`,
    });

    // Notification read rate
    const readRate = notifs.length > 0
      ? Math.round((notifs.filter(n => n.read_at).length / notifs.length) * 100)
      : 100;
    healthChecks.push({
      label:  'Notification read rate (7d)',
      status: readRate > 50 ? 'ok' : 'warn',
      detail: `${readRate}% of notifications read (${notifs.filter(n => n.read_at).length}/${notifs.length})`,
    });

    // Sellers currently in cooldown
    const cooldownCutoff = new Date(now.getTime() - SELLER_COOLDOWN_MS).toISOString();
    const recentCompletedListings = listings.filter(l =>
      l.status === 'COMPLETED' && l.completed_at && l.completed_at > cooldownCutoff
    );
    const sellersInCooldown = new Set(recentCompletedListings.map(l => l.seller_id)).size;
    healthChecks.push({
      label:  'Sellers in cooldown',
      status: 'ok',
      detail: `${sellersInCooldown} seller(s) currently in 90-min cooldown after completed sale`,
    });

    // Top sellers
    const sellerAgg: Record<string, { completed: number; revenue: number }> = {};
    for (const o of completed) {
      if (!sellerAgg[o.seller_id]) sellerAgg[o.seller_id] = { completed: 0, revenue: 0 };
      sellerAgg[o.seller_id].completed++;
      sellerAgg[o.seller_id].revenue += o.amount_cents ?? 0;
    }
    const topSellers = Object.entries(sellerAgg)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([id, s]) => ({ username: userMap[id] ?? id.slice(0, 8), ...s }));

    // Top buyers
    const buyerAgg: Record<string, { completed: number; spent: number }> = {};
    for (const o of completed) {
      if (!buyerAgg[o.buyer_id]) buyerAgg[o.buyer_id] = { completed: 0, spent: 0 };
      buyerAgg[o.buyer_id].completed++;
      buyerAgg[o.buyer_id].spent += o.amount_cents ?? 0;
    }
    const topBuyers = Object.entries(buyerAgg)
      .sort((a, b) => b[1].spent - a[1].spent)
      .slice(0, 10)
      .map(([id, b]) => ({ username: userMap[id] ?? id.slice(0, 8), ...b }));

    // Daily activity for 14-day sparkline
    const daily: { date: string; orders: number; completions: number; listings: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d   = new Date(now.getTime() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      daily.push({
        date:        key,
        orders:      orders.filter(o => o.created_at.slice(0, 10) === key).length,
        completions: completed.filter(o => (o.updated_at ?? o.created_at).slice(0, 10) === key).length,
        listings:    listings.filter(l => l.created_at.slice(0, 10) === key).length,
      });
    }

    // Enriched recent orders (most recent 40)
    const recentOrders = orders
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 40)
      .map(o => ({
        id:              o.id,
        status:          o.status,
        amount_cents:    o.amount_cents,
        created_at:      o.created_at,
        updated_at:      o.updated_at,
        buyer_username:  userMap[o.buyer_id]  ?? o.buyer_id.slice(0, 8),
        seller_username: userMap[o.seller_id] ?? o.seller_id.slice(0, 8),
        has_order_items: !!o.order_items,
        is_stale:        ['BUYER_SUBMITTED','SELLER_ACCEPTED'].includes(o.status) && o.updated_at < twoHoursAgo,
        lock_expired:    o.status === 'LOCKED' && !!o.lock_expires_at && new Date(o.lock_expires_at) < now,
      }));

    // Sellers currently in cooldown with end time
    const cooldownSellers = recentCompletedListings.map(l => ({
      seller_id:      l.seller_id,
      username:       userMap[l.seller_id] ?? l.seller_id.slice(0, 8),
      completed_at:   l.completed_at,
      cooldown_ends:  new Date(new Date(l.completed_at!).getTime() + SELLER_COOLDOWN_MS).toISOString(),
    }));

    // Audit log with usernames
    const recentAudit = auditLogs.slice(0, 100).map(row => ({
      id:          row.id,
      action:      row.action,
      entity_type: row.entity_type,
      entity_id:   row.entity_id,
      metadata:    row.metadata,
      created_at:  row.created_at,
      username:    row.user_id ? (userMap[row.user_id] ?? row.user_id.slice(0, 8)) : 'system',
    }));

    return NextResponse.json({
      generated_at:      now.toISOString(),
      users:             { total: profiles.length, new_24h: profiles.filter(p => p.created_at > s24h).length },
      listings:          listingStats,
      orders:            orderStats,
      revenue:           { total_cents: totalRevenue, avg_order_cents: avgOrder, completed_orders: completed.length, conversion_rate: conversionRate },
      activity_24h:      activity24h,
      daily,
      health:            healthChecks,
      top_sellers:       topSellers,
      top_buyers:        topBuyers,
      recent_orders:     recentOrders,
      recent_audit:      recentAudit,
      cooldown_sellers:  cooldownSellers,
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (e: any) {
    console.error('[admin/audit]', e);
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
