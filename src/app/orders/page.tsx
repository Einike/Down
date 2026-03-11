"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authedFetch, jsonOrThrow } from '@/lib/fetcher';
import { supabase } from '@/lib/supabaseClient';

type Order = { id:string; status:string; amount_cents:number; created_at:string; seller_id:string; buyer_id:string };

const STATUS_BADGE: Record<string, string> = {
  LOCKED:          'bg-amber-900/60 border-amber-700 text-amber-300',
  BUYER_SUBMITTED: 'bg-blue-900/60 border-blue-700 text-blue-300',
  SELLER_ACCEPTED: 'bg-purple-900/60 border-purple-700 text-purple-300',
  QR_UPLOADED:     'bg-emerald-900/60 border-emerald-700 text-emerald-300',
  COMPLETED:       'bg-slate-800/60 border-slate-600 text-slate-400',
  CANCELLED:       'bg-slate-800/60 border-slate-600 text-slate-500',
};

const STATUS_LABEL: Record<string, string> = {
  LOCKED:          '🔒 Locked',
  BUYER_SUBMITTED: '🍽️ Meal chosen',
  SELLER_ACCEPTED: '✅ Accepted',
  QR_UPLOADED:     '📲 QR ready',
  COMPLETED:       '🎉 Complete',
  CANCELLED:       '❌ Cancelled',
};

export default function OrdersPage() {
  const [orders, setOrders]   = useState<Order[]>([]);
  const [myId,   setMyId]     = useState('');
  const [loading,setLoading]  = useState(true);
  const [err,    setErr]      = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data:{session} }) => { if (session?.user) setMyId(session.user.id); });
    (async () => {
      try {
        const d = await jsonOrThrow<{ orders: Order[] }>(await authedFetch('/api/orders'));
        setOrders(d.orders ?? []);
      } catch (e: any) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6 flex justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">📦 My Orders</h1>

      {err && <p className="text-rose-400 text-sm">{err}</p>}

      {!err && orders.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-10 text-center space-y-4">
          <p className="text-4xl">📭</p>
          <p className="text-slate-300 font-semibold">No orders yet</p>
          <Link href="/board" className="inline-block px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold transition">
            Browse meals →
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {orders.map(o => {
          const role   = o.buyer_id === myId ? '👤 Buyer' : '🛒 Seller';
          const badge  = STATUS_BADGE[o.status] ?? STATUS_BADGE.CANCELLED;
          const label  = STATUS_LABEL[o.status] ?? o.status;
          return (
            <Link key={o.id} href={`/orders/${o.id}`}
              className="flex items-center gap-3 p-4 rounded-2xl border border-slate-700 bg-slate-900/40 hover:border-slate-500 transition">
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="font-bold text-white">${(o.amount_cents/100).toFixed(2)} · Ortega meal</p>
                <p className="text-slate-400 text-xs">{role} · {new Date(o.created_at).toLocaleDateString()}</p>
                <p className="text-slate-500 font-mono text-[10px]">#{o.id.slice(0,8).toUpperCase()}</p>
              </div>
              <span className={`shrink-0 px-2.5 py-1 rounded-full border text-xs font-medium ${badge}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
