import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data, error } = await admin.from('orders').select('*').eq('id', id).single();
    if (error || !data) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (data.buyer_id !== u.id && data.seller_id !== u.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Fetch seller payment methods so buyer can see them during payment step.
    // Always included so buyer doesn't need a separate API call.
    const { data: paymentMethods } = await admin
      .from('user_payment_methods')
      .select('method,handle,is_active')
      .eq('user_id', data.seller_id)
      .eq('is_active', true)
      .order('method');

    // Fetch seller username for display
    const { data: sellerProfile } = await admin
      .from('profiles')
      .select('username')
      .eq('id', data.seller_id)
      .single();

    return NextResponse.json({
      order: {
        ...data,
        seller_username:       sellerProfile?.username ?? null,
        seller_payment_methods: paymentMethods ?? [],
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma':        'no-cache',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
