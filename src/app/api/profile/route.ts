import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    const u = await requireUser(req);
    const { data } = await admin.from('profiles').select('id,username,email,created_at').eq('id', u.id).single();
    return NextResponse.json({ profile: data ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}
