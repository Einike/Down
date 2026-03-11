import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';

const VALID_METHODS = ['venmo', 'zelle', 'apple_pay', 'paypal', 'cash_app'] as const;
type PaymentMethod = typeof VALID_METHODS[number];

// GET  — current user's payment methods
export async function GET(req: NextRequest) {
  try {
    const u = await requireUser(req);
    const { data, error } = await admin
      .from('user_payment_methods')
      .select('id,method,handle,is_active,updated_at')
      .eq('user_id', u.id)
      .order('method');
    if (error) throw error;
    return NextResponse.json({ payment_methods: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// POST — upsert a single payment method
// body: { method: string; handle: string; is_active?: boolean }
export async function POST(req: NextRequest) {
  try {
    const u    = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const method    = (body.method ?? '').toLowerCase().trim() as PaymentMethod;
    const handle    = typeof body.handle    === 'string' ? body.handle.trim()    : '';
    const is_active = typeof body.is_active === 'boolean' ? body.is_active : true;

    if (!VALID_METHODS.includes(method))
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    if (!handle || handle.length > 100)
      return NextResponse.json({ error: 'Handle is required (max 100 characters)' }, { status: 400 });

    const { error } = await admin.from('user_payment_methods').upsert(
      {
        user_id:    u.id,
        method,
        handle,
        is_active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,method' },
    );
    if (error) {
      console.error('[payment-methods.POST]', error);
      return NextResponse.json({ error: 'Failed to save payment method' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// DELETE — remove a payment method
// query: ?method=venmo
export async function DELETE(req: NextRequest) {
  try {
    const u      = await requireUser(req);
    const method = req.nextUrl.searchParams.get('method')?.toLowerCase().trim();
    if (!method || !VALID_METHODS.includes(method as PaymentMethod))
      return NextResponse.json({ error: 'Invalid method' }, { status: 400 });

    const { error } = await admin.from('user_payment_methods')
      .delete()
      .eq('user_id', u.id)
      .eq('method', method);
    if (error) {
      console.error('[payment-methods.DELETE]', error);
      return NextResponse.json({ error: 'Failed to delete payment method' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
