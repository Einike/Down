import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    const u = await requireUser(req);
    const { data, error } = await admin.from('orders').select('*')
      .or(`buyer_id.eq.${u.id},seller_id.eq.${u.id}`)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
    return NextResponse.json({ orders: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}
