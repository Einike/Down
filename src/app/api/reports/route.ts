import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { auditLog } from '@/lib/audit';

const VALID_REASONS = [
  'no_show',
  'harassment',
  'spam_fake_listing',
  'scam_suspicious',
  'inappropriate_content',
  'repeated_cancellations',
  'other',
] as const;

// POST /api/reports — authenticated users submit a report against another user
export async function POST(req: NextRequest) {
  try {
    const u = await requireUser(req);

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }

    const { reported_user_id, order_id, listing_id, reason_code, message } = body as Record<string, string | undefined>;

    // Validation
    if (!reported_user_id)
      return NextResponse.json({ error: 'reported_user_id is required' }, { status: 422 });
    if (reported_user_id === u.id)
      return NextResponse.json({ error: 'You cannot report yourself' }, { status: 422 });
    if (!reason_code || !VALID_REASONS.includes(reason_code as any))
      return NextResponse.json({ error: 'A valid reason is required' }, { status: 422 });
    if (!message || message.trim().length < 10)
      return NextResponse.json({ error: 'Please write at least 10 characters describing the issue' }, { status: 422 });
    if (message.trim().length > 2000)
      return NextResponse.json({ error: 'Message must be 2000 characters or fewer' }, { status: 422 });

    // Verify reported user exists
    const { data: reportedProfile } = await admin
      .from('profiles').select('id').eq('id', reported_user_id).single();
    if (!reportedProfile)
      return NextResponse.json({ error: 'Reported user not found' }, { status: 404 });

    // If an order_id is provided, verify the reporter is a participant
    if (order_id) {
      const { data: order } = await admin
        .from('orders').select('buyer_id,seller_id').eq('id', order_id).single();
      if (!order || (order.buyer_id !== u.id && order.seller_id !== u.id))
        return NextResponse.json({ error: 'You are not a participant in that order' }, { status: 403 });
    }

    const { data, error } = await admin.from('reports').insert({
      reporter_id:      u.id,
      reported_user_id,
      order_id:         order_id   ?? null,
      listing_id:       listing_id ?? null,
      reason_code,
      message:          message.trim(),
    }).select('id').single();

    if (error) {
      console.error('[report.submit]', error);
      return NextResponse.json({ error: 'Failed to submit report' }, { status: 500 });
    }

    await auditLog(u.id, 'report.submit', 'report', data.id, { reason_code, reported_user_id });
    return NextResponse.json({ ok: true, report_id: data.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 401 });
  }
}
