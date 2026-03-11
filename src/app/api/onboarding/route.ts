import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export async function POST(req: NextRequest) {
  try {
    const u    = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const raw  = (body.username ?? '').trim().toLowerCase();

    if (!raw) return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    if (!USERNAME_RE.test(raw))
      return NextResponse.json({ error: '3–20 chars, lowercase letters/numbers/underscore only' }, { status: 422 });

    const { error } = await admin.from('profiles').upsert(
      { id: u.id, email: u.email ?? '', username: raw },
      { onConflict: 'id' }
    );

    if (error) {
      if (error.message.includes('unique') || error.message.includes('duplicate'))
        return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
      return NextResponse.json({ error: 'Failed to save username' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}
