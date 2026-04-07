import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { ACTIVE_ORDER_STATUSES, CLAIM_COOLDOWN_MS, BUYER_COOLDOWN_MS, DAILY_BUYER_CLAIM_LIMIT } from '@/lib/status';
import { isOrtegaOpen } from '@/lib/ortegaHours';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/audit';
import { pacificDayStart, nextPacificDayStart } from '@/lib/timeUtils';

const claimAttempts = new Map<string, number>(); // userId → last attempt ts (best-effort, resets on cold start)

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    if (!isOrtegaOpen()) {
      await auditLog(null, 'order.claim_blocked', 'listing', id, { reason: 'ortega_closed' });
      return NextResponse.json({ error: 'Ortega is currently closed.' }, { status: 400 });
    }

    // Best-effort in-memory rate limit (1 req/min per user).
    // Note: resets on serverless cold starts — DB checks below are the real enforcement.
    const last    = claimAttempts.get(u.id) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < CLAIM_COOLDOWN_MS) {
      const wait = Math.ceil((CLAIM_COOLDOWN_MS - elapsed) / 1000);
      await auditLog(u.id, 'order.claim_blocked', 'listing', id, { reason: 'rate_limit', wait_secs: wait });
      return NextResponse.json({ error: `Wait ${wait}s before claiming again` }, { status: 429 });
    }
    claimAttempts.set(u.id, Date.now());

    // ── 1. Auto-cancel stale LOCKED orders (expired 10-min lock) ──────────
    // When a buyer claims but never submits within 10 minutes, the listing gets
    // restored to OPEN but the order stays stuck in LOCKED status forever,
    // blocking the buyer from claiming again. Clean those up first.
    const { error: cancelErr } = await admin.from('orders')
      .update({
        status:             'CANCELLED',
        cancelled_by:       u.id,
        cancel_reason_code: 'lock_expired',
        cancel_reason_text: 'Lock expired — buyer did not submit within 10 minutes',
        updated_at:         new Date().toISOString(),
      })
      .eq('buyer_id', u.id)
      .eq('status', 'LOCKED')
      .lt('lock_expires_at', new Date().toISOString());
    if (cancelErr) {
      console.error('[claim] auto-cancel failed:', cancelErr.message, cancelErr.code);
      await auditLog(u.id, 'order.claim_autocancelfail', 'listing', id, { message: cancelErr.message, code: cancelErr.code });
    }

    // ── 2. One active order per buyer ─────────────────────────────────────
    // The DB partial index orders_one_active_per_buyer enforces this at insert
    // time too, so this is a friendly early-exit to give a clear error.
    const { data: ao } = await admin.from('orders')
      .select('id').eq('buyer_id', u.id).in('status', ACTIVE_ORDER_STATUSES).limit(1);
    if (ao?.length) {
      await auditLog(u.id, 'order.claim_blocked', 'listing', id, { reason: 'active_order_exists', active_order_id: ao[0].id });
      return NextResponse.json({ error: 'You already have an active order' }, { status: 409 });
    }

    // ── 2. Daily buyer claim cap — 3 meals per Pacific calendar day ────────
    // Counts all orders created today EXCEPT those cancelled by the seller
    // (the buyer should not be penalised for a seller no-show).
    // Buyer-initiated cancellations DO count to prevent spam-claim-cancel abuse.
    const dayStart   = pacificDayStart();
    const dayResetAt = nextPacificDayStart();

    const { count: todayCount, error: countErr } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', u.id)
      .gte('created_at', dayStart)
      .or(`status.neq.CANCELLED,cancelled_by.eq.${u.id}`);
      // OR logic:
      //   status != CANCELLED            → active / completed orders always count
      //   cancelled_by = buyer_id        → buyer-cancelled orders count (anti-spam)
      //   status = CANCELLED AND cancelled_by = seller_id → NOT counted (seller's fault)

    if (countErr) {
      console.error('[claim] daily-count query failed:', countErr);
      // Non-fatal: fall through and let the DB trigger catch it if needed
    } else if ((todayCount ?? 0) >= DAILY_BUYER_CLAIM_LIMIT) {
      await auditLog(u.id, 'order.claim_blocked', 'listing', id, { reason: 'daily_limit', claimed_today: todayCount });
      return NextResponse.json({
        error: `Daily limit reached — you can claim up to ${DAILY_BUYER_CLAIM_LIMIT} meals per day. Your limit resets at midnight Pacific time.`,
        daily_limit:   DAILY_BUYER_CLAIM_LIMIT,
        claimed_today: todayCount,
        resets_at:     dayResetAt,
      }, { status: 429 });
    }

    // ── 3. 90-min buyer cooldown after completing a purchase ───────────────
    const cooldownAfter = new Date(Date.now() - BUYER_COOLDOWN_MS).toISOString();
    const { data: recentCompleted } = await admin.from('orders')
      .select('updated_at')
      .eq('buyer_id', u.id)
      .eq('status', 'COMPLETED')
      .gt('updated_at', cooldownAfter)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (recentCompleted?.length) {
      const wait = Math.ceil(
        (new Date(recentCompleted[0].updated_at).getTime() + BUYER_COOLDOWN_MS - Date.now()) / 60_000,
      );
      await auditLog(u.id, 'order.claim_blocked', 'listing', id, { reason: 'buyer_cooldown', wait_mins: wait });
      return NextResponse.json(
        { error: `Please wait ${wait} more min before claiming again (90-min cooldown after each purchase)` },
        { status: 429 },
      );
    }

    // ── 4. Atomic claim (DB-level lock + order insert) ─────────────────────
    const lock_until = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data, error } = await admin.rpc('claim_listing_atomic', {
      p_listing_id: id, p_buyer_id: u.id, p_lock_until: lock_until,
    });

    if (error) {
      const msg = error.message ?? 'RPC error (no message)';
      console.error('[claim] rpc error:', error.code, msg, error.details, error.hint);
      await auditLog(u.id, 'order.claim_failed', 'listing', id, {
        stage: 'rpc_error', code: error.code, message: msg, details: error.details, hint: error.hint,
      });
      return NextResponse.json({
        error: msg,
        _debug: { code: error.code, details: error.details, hint: error.hint },
      }, { status: 500 });
    }

    // Supabase can return JSONB as a raw string in some client versions — parse defensively
    const result = typeof data === 'string' ? JSON.parse(data) : data;

    if (!result?.ok) {
      const msg = result?.error ?? `RPC returned: ${JSON.stringify(result)}`;
      console.error('[claim] not ok:', JSON.stringify(result));
      await auditLog(u.id, 'order.claim_failed', 'listing', id, {
        stage: 'rpc_not_ok', rpc_result: result,
      });
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    const order = result.order;
    await auditLog(u.id, 'order.claim', 'order', order.id, { listing_id: id });
    await notify(order.seller_id, 'listing_claimed', '🎉 Meal claimed!',
      'A buyer locked your listing. Accept their order when they submit meal choices.', `/orders/${order.id}`);

    return NextResponse.json({ order });
  } catch (e: any) {
    // Log unexpected errors (includes requireUser failures, network errors, etc.)
    // Note: u may not be defined if requireUser threw, so we pass null for userId
    try {
      const { id: listingId } = await ctx.params;
      await auditLog(null, 'order.claim_error', 'listing', listingId, { message: e.message, status: e.status });
    } catch { /* auditLog already has internal catch — this is extra insurance */ }
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
