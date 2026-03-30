import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { OrderStatus } from '@/lib/status';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/audit';

const SCREENSHOT_BUCKET = 'payment-screenshots';

// POST — buyer taps "I Sent Payment"
// Accepts multipart/form-data with optional 'file' field (screenshot).
// Moves order BUYER_SUBMITTED → PAYMENT_SENT and notifies seller.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order, error: fetchErr } = await admin
      .from('orders').select('*').eq('id', id).single();
    if (fetchErr || !order)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.buyer_id !== u.id)
      return NextResponse.json({ error: 'Only the buyer can mark payment sent' }, { status: 403 });
    if (order.status !== OrderStatus.BUYER_SUBMITTED)
      return NextResponse.json(
        { error: `Cannot mark payment sent from status ${order.status}` },
        { status: 400 },
      );

    // ── Optional screenshot upload ────────────────────────────────────────
    let screenshotUrl: string | null = null;
    const contentType = req.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file') as File | null;

      if (file && file.size > 0) {
        if (!file.type.startsWith('image/'))
          return NextResponse.json({ error: 'Screenshot must be an image file' }, { status: 400 });
        if (file.size > 5 * 1024 * 1024)
          return NextResponse.json({ error: 'Screenshot too large (max 5 MB)' }, { status: 400 });

        const ext    = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
        const path   = `orders/${id}/screenshot/${Date.now()}.${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());

        const { error: upErr } = await admin.storage
          .from(SCREENSHOT_BUCKET)
          .upload(path, buffer, { contentType: file.type, upsert: true });

        if (upErr) {
          console.error('[payment-sent] screenshot upload failed:', upErr);
          // Non-fatal — proceed without screenshot
        } else {
          screenshotUrl = path;
        }
      }
    }

    // ── Advance order status ───────────────────────────────────────────────
    const patch: Record<string, unknown> = {
      status:         OrderStatus.PAYMENT_SENT,
      payment_sent_at: new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    };
    if (screenshotUrl) patch.payment_screenshot_url = screenshotUrl;

    // Optimistic lock — only update if status is STILL BUYER_SUBMITTED (prevents double-tap).
    const { data: updated, error: updateErr } = await admin.from('orders')
      .update(patch)
      .eq('id', id)
      .eq('status', OrderStatus.BUYER_SUBMITTED)
      .select('id');
    if (updateErr) {
      console.error('[payment-sent] DB update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }
    if (!updated?.length)
      return NextResponse.json({ error: 'Order status changed — refresh and try again' }, { status: 409 });

    await auditLog(u.id, 'order.payment_sent', 'order', id, {
      has_screenshot: !!screenshotUrl,
    });

    // Seller gets an urgent notification — they need to confirm quickly
    await notify(
      order.seller_id,
      'payment_sent',
      '💸 Buyer says payment sent!',
      `Check your ${order.amount_cents === 0 ? 'app' : `$${(order.amount_cents / 100).toFixed(2)}`} payment — then confirm receipt so the QR step unlocks.`,
      `/orders/${id}`,
    );

    return NextResponse.json({ ok: true, has_screenshot: !!screenshotUrl });
  } catch (e: any) {
    console.error('[payment-sent] unexpected error:', e);
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
