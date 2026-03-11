import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';
import { admin } from '@/lib/supabaseAdmin';

// GET /api/admin/reports?status=open&reason=no_show&page=0
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const status  = searchParams.get('status')  ?? '';   // filter by report status
    const reason  = searchParams.get('reason')  ?? '';   // filter by reason_code
    const page    = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10));
    const limit   = 50;

    let q = admin.from('reports')
      .select('id,created_at,updated_at,reporter_id,reported_user_id,order_id,listing_id,reason_code,message,status,admin_notes,reviewed_by,reviewed_at')
      .order('created_at', { ascending: false })
      .range(page * limit, page * limit + limit - 1);

    if (status) q = q.eq('status', status);
    if (reason) q = q.eq('reason_code', reason);

    const { data: reports, error } = await q;
    if (error) {
      console.error('[admin.reports.list]', error);
      return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
    }

    // Resolve usernames for all involved users in one pass
    const userIds = [...new Set([
      ...reports.map((r: any) => r.reporter_id),
      ...reports.map((r: any) => r.reported_user_id),
      ...reports.filter((r: any) => r.reviewed_by).map((r: any) => r.reviewed_by),
    ])];

    let usernameMap: Record<string, string> = {};
    if (userIds.length) {
      const { data: profiles } = await admin
        .from('profiles').select('id,username,email').in('id', userIds);
      usernameMap = Object.fromEntries(
        (profiles ?? []).map((p: any) => [p.id, p.username ?? p.email ?? p.id]),
      );
    }

    const enriched = reports.map((r: any) => ({
      ...r,
      reporter_username:      usernameMap[r.reporter_id]      ?? r.reporter_id,
      reported_user_username: usernameMap[r.reported_user_id] ?? r.reported_user_id,
      reviewed_by_username:   r.reviewed_by ? (usernameMap[r.reviewed_by] ?? r.reviewed_by) : null,
    }));

    return NextResponse.json({ reports: enriched, page, limit });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
