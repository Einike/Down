import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';
import { admin } from '@/lib/supabaseAdmin';
import { auditLog } from '@/lib/audit';

// POST /api/admin/users/[id]/ban
// body: { reason: string, days?: number }  — omit days for permanent ban
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor  = await requireAdmin(req);
    const { id } = await ctx.params;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}

    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'Suspended by admin';

    const days = typeof body.days === 'number' && body.days > 0 ? body.days : null;
    const banned_until = days
      ? new Date(Date.now() + days * 86_400_000).toISOString()
      : null;

    // Prevent banning another admin
    const { data: target } = await admin
      .from('profiles').select('role,email').eq('id', id).single();
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (target.role === 'admin')
      return NextResponse.json({ error: 'Cannot ban an admin account' }, { status: 403 });

    const { error } = await admin.from('profiles').update({
      is_banned:    true,
      banned_until,
      ban_reason:   reason,
      banned_by:    actor.id,
    }).eq('id', id);

    if (error) {
      console.error('[admin.ban]', error);
      return NextResponse.json({ error: 'Failed to ban user' }, { status: 500 });
    }

    await auditLog(actor.id, 'admin.ban', 'profile', id, {
      reason,
      days: days ?? 'permanent',
      banned_until,
    });

    return NextResponse.json({
      ok: true,
      banned_until,
      permanent: !days,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
