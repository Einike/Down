import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';
import { admin } from '@/lib/supabaseAdmin';
import { auditLog } from '@/lib/audit';

// POST /api/admin/users/[id]/unban
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor  = await requireAdmin(req);
    const { id } = await ctx.params;

    const { error } = await admin.from('profiles').update({
      is_banned:    false,
      banned_until: null,
      ban_reason:   null,
      banned_by:    null,
    }).eq('id', id);

    if (error) {
      console.error('[admin.unban]', error);
      return NextResponse.json({ error: 'Failed to unban user' }, { status: 500 });
    }

    await auditLog(actor.id, 'admin.unban', 'profile', id, {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
