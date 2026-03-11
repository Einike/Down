import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { OrderStatus } from '@/lib/status';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/audit';

const BUCKET = 'order-qr';

// POST: seller uploads QR
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order, error: oErr } = await admin.from('orders').select('*').eq('id', id).single();
    if (oErr || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.seller_id !== u.id)
      return NextResponse.json({ error: 'Only the seller can upload the QR' }, { status: 403 });
    if (order.status !== OrderStatus.SELLER_ACCEPTED)
      return NextResponse.json({ error: `Upload QR when order is SELLER_ACCEPTED (currently ${order.status})` }, { status: 400 });

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!file.type.startsWith('image/'))
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024)
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 });

    const ext    = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
    const path   = `orders/${id}/qr/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType: file.type, upsert: true,
    });
    if (upErr) {
      console.error('[qr.upload]', upErr);
      if (upErr.message.includes('Bucket not found') || upErr.message.includes('bucket'))
        return NextResponse.json({ error: 'Storage not configured — contact support' }, { status: 500 });
      return NextResponse.json({ error: 'Upload failed — please try again' }, { status: 500 });
    }

    // DB write — check error explicitly (storage succeeded, must not leave order stuck)
    const { error: updateErr } = await admin.from('orders').update({
      qr_image_url: path,
      status:       OrderStatus.QR_UPLOADED,
      updated_at:   new Date().toISOString(),
    }).eq('id', id);

    if (updateErr) {
      console.error('[qr.upload] DB update failed after storage upload:', updateErr);
      // File is in storage but order not advanced — attempt cleanup
      await admin.storage.from(BUCKET).remove([path]).catch(() => {});
      return NextResponse.json({
        error: 'QR upload failed — order status not updated. Please try again.',
      }, { status: 500 });
    }

    await auditLog(u.id, 'order.qr_upload', 'order', id);
    await notify(order.buyer_id, 'qr_uploaded', '📲 QR ready!',
      'The seller uploaded the Ortega QR. Head to Ortega to pick up your meal!', `/orders/${id}`);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[qr.POST]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET: returns 5-minute signed URL (buyer or seller only)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    const { data: order } = await admin.from('orders').select('*').eq('id', id).single();
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.buyer_id !== u.id && order.seller_id !== u.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!order.qr_image_url)
      return NextResponse.json({ error: 'Seller has not uploaded the QR yet' }, { status: 404 });

    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET).createSignedUrl(order.qr_image_url, 300); // 5 min expiry

    if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 });
    return NextResponse.json({ url: signed.signedUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
}
