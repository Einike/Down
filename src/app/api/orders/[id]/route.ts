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

    // Convert raw screenshot path to a short-lived signed URL (seller only).
    // Never expose the raw storage path — a signed URL is useless after 5 min.
    let payment_screenshot_signed_url: string | null = null;
    if (data.payment_screenshot_url && u.id === data.seller_id) {
      const { data: signed } = await admin.storage
        .from('payment-screenshots')
        .createSignedUrl(data.payment_screenshot_url, 300); // 5 min
      payment_screenshot_signed_url = signed?.signedUrl ?? null;
    }

    // Strip the raw path from the response regardless of caller
    const { payment_screenshot_url: _raw, ...orderFields } = data;

    return NextResponse.json({
      order: {
        ...orderFields,
        has_payment_screenshot:       !!data.payment_screenshot_url,
        payment_screenshot_signed_url,
        seller_username:              sellerProfile?.username ?? null,
        seller_payment_methods:       paymentMethods ?? [],
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
