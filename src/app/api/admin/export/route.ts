import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/requireAdmin';
import { admin } from '@/lib/supabaseAdmin';
import { auditLog } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdmin(req);

    const [ordersRes, profilesRes, listingsRes] = await Promise.all([
      admin.from('orders')
        .select('id,status,buyer_id,seller_id,amount_cents,created_at,updated_at,order_items')
        .limit(5000),
      admin.from('profiles').select('id,username,email').limit(5000),
      admin.from('listings')
        .select('id,status,seller_id,price_cents,created_at,completed_at')
        .limit(5000),
    ]);

    const orders   = ordersRes.data   ?? [];
    const profiles = profilesRes.data ?? [];
    const listings = listingsRes.data ?? [];

    const userMap: Record<string, { username: string; email: string }> = {};
    for (const p of profiles) userMap[p.id] = { username: p.username ?? '', email: p.email ?? '' };

    const rows = orders.map(o => ({
      order_id:         o.id,
      status:           o.status,
      amount_dollars:   ((o.amount_cents ?? 0) / 100).toFixed(2),
      buyer_username:   userMap[o.buyer_id]?.username  ?? '',
      buyer_email:      userMap[o.buyer_id]?.email      ?? '',
      seller_username:  userMap[o.seller_id]?.username ?? '',
      seller_email:     userMap[o.seller_id]?.email     ?? '',
      created_at:       o.created_at,
      updated_at:       o.updated_at,
      entree:           o.order_items?.entree   ?? '',
      side:             o.order_items?.side     ?? '',
      dessert:          o.order_items?.dessert  ?? '',
      fruits:           (o.order_items?.fruits ?? []).join('; '),
      beverage:         o.order_items?.beverage ?? '',
      notes:            o.order_items?.notes    ?? '',
    }));

    // Audit every export so we know who pulled data and when
    await auditLog(actor.id, 'admin.export', 'orders', null as any, {
      row_count:   rows.length,
      exported_at: new Date().toISOString(),
    });

    const headers = Object.keys(rows[0] ?? {});
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = String((r as any)[h] ?? '').replace(/"/g, '""');
        return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v}"` : v;
      }).join(',')),
    ].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="gauchogrub-orders-${new Date().toISOString().slice(0,10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
