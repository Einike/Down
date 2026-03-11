import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';
import { admin } from '@/lib/supabaseAdmin';
import { auditLog } from '@/lib/audit';

const VALID_STATUSES = ['open', 'reviewed', 'resolved', 'dismissed'] as const;

// PATCH /api/admin/reports/[id] — update status and/or admin notes
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor  = await requireAdmin(req);
    const { id } = await ctx.params;

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

    const { status, admin_notes } = body as { status?: string; admin_notes?: string };

    if (status && !VALID_STATUSES.includes(status as any))
      return NextResponse.json({ error: 'Invalid status value' }, { status: 422 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status)       patch.status      = status;
    if (typeof admin_notes === 'string') patch.admin_notes = admin_notes.trim() || null;
    if (status && status !== 'open') {
      patch.reviewed_by = actor.id;
      patch.reviewed_at = new Date().toISOString();
    }

    const { error } = await admin.from('reports').update(patch).eq('id', id);
    if (error) {
      console.error('[admin.reports.update]', error);
      return NextResponse.json({ error: 'Failed to update report' }, { status: 500 });
    }

    await auditLog(actor.id, 'admin.report_update', 'report', id, { status, has_notes: !!admin_notes });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
