import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';

// PATCH /api/notifications/[id] — mark a single notification as read
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { error } = await admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', u.id)   // user can only mark their own notifications
      .is('read_at', null);  // no-op if already read

    if (error) {
      console.error('[notifications/[id]] mark-read failed:', error);
      return NextResponse.json({ error: 'Failed to mark read' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
