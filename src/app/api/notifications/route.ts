import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    const u = await requireUser(req);
    const { data } = await admin.from('notifications')
      .select('id,type,title,body,link,read_at,created_at')
      .eq('user_id', u.id)
      .order('created_at', { ascending: false }).limit(30);
    return NextResponse.json({ notifications: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const u = await requireUser(req);
    await admin.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', u.id).is('read_at', null);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}
