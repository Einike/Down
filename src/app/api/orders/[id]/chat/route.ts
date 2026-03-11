import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/authServer';
import { admin } from '@/lib/supabaseAdmin';
import { notify } from '@/lib/notify';

// GET — fetch chat messages for an order (newest 100, ascending)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    // Permission check — must be buyer or seller for this order
    const { data: order } = await admin
      .from('orders').select('buyer_id,seller_id').eq('id', id).single();
    if (!order)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.buyer_id !== u.id && order.seller_id !== u.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: messages, error } = await admin
      .from('order_messages')
      .select('id,sender_id,body,created_at')
      .eq('order_id', id)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw error;

    // Resolve sender usernames in a single query
    const senderIds = [...new Set((messages ?? []).map(m => m.sender_id))];
    let usernameMap: Record<string, string> = {};
    if (senderIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id,username')
        .in('id', senderIds);
      usernameMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.username]));
    }

    const enriched = (messages ?? []).map(m => ({
      ...m,
      sender_username: usernameMap[m.sender_id] ?? 'unknown',
    }));

    return NextResponse.json({ messages: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// POST — send a chat message
// body: { body: string }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const u      = await requireUser(req);
    const { id } = await ctx.params;

    // Permission + status check
    const { data: order } = await admin
      .from('orders').select('buyer_id,seller_id,status').eq('id', id).single();
    if (!order)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.buyer_id !== u.id && order.seller_id !== u.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (['COMPLETED','CANCELLED','DISPUTED'].includes(order.status))
      return NextResponse.json({ error: 'Chat is closed for this order' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text || text.length > 2000)
      return NextResponse.json({ error: 'Message must be 1–2000 characters' }, { status: 400 });

    const { data: msg, error: insertErr } = await admin
      .from('order_messages')
      .insert({ order_id: id, sender_id: u.id, body: text })
      .select('id,sender_id,body,created_at')
      .single();

    if (insertErr) {
      console.error('[chat.POST] insert failed:', insertErr);
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }

    // Notify the other party (best-effort, non-blocking)
    const other = u.id === order.buyer_id ? order.seller_id : order.buyer_id;
    await notify(
      other,
      'chat_message',
      '💬 New message',
      text.length > 80 ? text.slice(0, 77) + '…' : text,
      `/orders/${id}`,
    );

    return NextResponse.json({ message: msg });
  } catch (e: any) {
    console.error('[chat.POST] unexpected error:', e);
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
