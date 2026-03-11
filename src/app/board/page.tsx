"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetch, jsonOrThrow } from '@/lib/fetcher';
import { supabase } from '@/lib/supabaseClient';
// FIX: import now resolves — ortegaClosedReason is re-exported from ortegaHours.ts
// FIX: removed render-time call; closed is state updated via useEffect only
import { getClosedReason } from '@/lib/ortegaHours';

type L = { id:string; price_cents:number; seller_username:string; seller_id:string; expires_at:string; status:string; seller_avg_rating:number|null; seller_review_count:number };

function Cd({ at }: { at: string }) {
  // FIX: initialise to '' so SSR and first client render both produce '' — no mismatch
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.floor((new Date(at).getTime() - Date.now()) / 1000));
      setT(`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`);
    };
    tick(); const i = setInterval(tick, 1000); return () => clearInterval(i);
  }, [at]);
  return <span className="font-mono">{t}</span>;
}

export default function BoardPage() {
  const router  = useRouter();
  const [rows,  setRows]  = useState<L[]>([]);
  const [myId,  setMyId]  = useState('');
  const [load,  setLoad]  = useState(true);
  const [err,   setErr]   = useState('');
  const [busy,      setBusy]      = useState('');
  const [toast,     setToast]     = useState('');
  const [toastKind, setToastKind] = useState<'error' | 'limit'>('error');
  const tt = useRef<ReturnType<typeof setTimeout>>(undefined);

  // FIX: was "const closed = ortegaClosedReason()" at module/render scope — hydration error.
  // Now lives in state, populated only inside useEffect (client-only).
  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => {
    setClosed(getClosedReason());
    const t = setInterval(() => setClosed(getClosedReason()), 60_000);
    return () => clearInterval(t);
  }, []);

  const showToast = (m: string, kind: 'error' | 'limit' = 'error') => {
    setToast(m); setToastKind(kind); clearTimeout(tt.current);
    tt.current = setTimeout(() => setToast(''), kind === 'limit' ? 8000 : 5000);
  };

  const fetch_ = async () => {
    try {
      setLoad(true); setErr('');
      const d = await jsonOrThrow<{ listings: L[] }>(await authedFetch('/api/listings'));
      setRows(d.listings ?? []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoad(false); }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { if (session?.user) setMyId(session.user.id); });
    fetch_(); const t = setInterval(fetch_, 30_000); return () => clearInterval(t);
  }, []);

  const claim = async (listingId: string, sellerId: string) => {
    if (sellerId === myId) { showToast("You can't claim your own listing"); return; }
    if (closed) { showToast(closed); return; }
    try {
      setBusy(listingId);
      const res  = await authedFetch(`/api/listings/${listingId}/claim`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        // Daily limit gets a distinct amber banner; all other errors stay red
        const isLimit = res.status === 429 && data.daily_limit != null;
        showToast(data.error ?? `Error ${res.status}`, isLimit ? 'limit' : 'error');
        await fetch_();
        return;
      }
      router.push(`/orders/${data.order.id}`);
    } catch (e: any) { showToast(e.message); await fetch_(); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed top-3 inset-x-4 z-50 rounded-xl px-4 py-3 text-sm text-center shadow-xl border
          ${toastKind === 'limit'
            ? 'bg-amber-950/90 border-amber-600 text-amber-200'
            : 'bg-rose-900 border-rose-600 text-rose-100'}`}>
          {toastKind === 'limit' && <span className="mr-1">🍽️</span>}
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">🏠 Live Board</h1>
          <p className="text-slate-400 text-sm">Available Ortega meals</p>
        </div>
        <button onClick={fetch_} className="text-slate-400 hover:text-white text-sm px-3 py-1 rounded-lg border border-slate-700 transition">↻ Refresh</button>
      </div>

      {closed && (
        <div className="rounded-2xl border border-amber-700 bg-amber-950/30 p-4 text-center">
          <p className="text-amber-300 font-semibold text-sm">🚫 {closed}</p>
          <p className="text-slate-500 text-xs mt-1">Ortega: Mon–Fri 10 AM–8 PM PT</p>
        </div>
      )}

      {load && <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="rounded-2xl border border-slate-700 h-24 animate-pulse bg-slate-800/40" />)}</div>}

      {!load && err && <div className="rounded-2xl border border-rose-800 bg-rose-950/30 p-4 space-y-2"><p className="text-rose-300 text-sm">{err}</p><button onClick={fetch_} className="text-sm px-3 py-1 rounded bg-slate-700 hover:bg-slate-600">Retry</button></div>}

      {!load && !err && rows.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-8 text-center space-y-4">
          <p className="text-4xl">🍽️</p>
          <p className="text-slate-300 font-semibold">No meals listed right now</p>
          <Link href="/sell" className="inline-block px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-sm transition">Sell an Ortega meal →</Link>
        </div>
      )}

      {!load && !err && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map(x => {
            const isOwn    = x.seller_id === myId;
            const isFree   = x.price_cents === 0;
            const expiring = (new Date(x.expires_at).getTime() - Date.now()) < 10 * 60_000;
            return (
              <article key={x.id} className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-black">{isFree ? '🎁 Free' : `$${(x.price_cents/100).toFixed(2)}`}</span>
                      <span className="text-slate-400 text-sm">· Ortega meal</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <span>@{x.seller_username}</span>
                      {x.seller_avg_rating != null && (
                        <span className="text-yellow-400">⭐ {x.seller_avg_rating.toFixed(1)}</span>
                      )}
                      {x.seller_review_count > 0 && (
                        <span className="text-slate-500">({x.seller_review_count})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-900/50 border border-emerald-700 text-emerald-300">OPEN</span>
                      <span className={`px-2 py-0.5 rounded-full border font-mono ${expiring ? 'bg-amber-900/50 border-amber-700 text-amber-300' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>
                        ⏱ <Cd at={x.expires_at} />
                      </span>
                      {isFree && <span className="px-2 py-0.5 rounded-full bg-purple-900/50 border border-purple-700 text-purple-300">FREE</span>}
                      {isOwn  && <span className="px-2 py-0.5 rounded-full bg-blue-900/50 border border-blue-700 text-blue-300">YOUR LISTING</span>}
                    </div>
                  </div>
                  <button
                    disabled={!!busy || isOwn || !!closed}
                    onClick={() => claim(x.id, x.seller_id)}
                    title={isOwn ? "Can't claim your own listing" : closed ?? undefined}
                    className={`shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm transition min-w-[90px] text-center
                      ${isOwn || closed ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-60'}`}>
                    {busy === x.id ? '…' : isOwn ? 'Yours' : 'Lock meal'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
