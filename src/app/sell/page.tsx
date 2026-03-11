"use client";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetch, jsonOrThrow } from '@/lib/fetcher';
import { getClosedReason } from '@/lib/menu';

const WINDOWS_MIN = [15, 30, 45, 60] as const;
type ActiveListing = { id: string; expires_at: string; price_cents: number };

function Countdown({ expiresAt, onExpired, accent = 'text-amber-300' }: { expiresAt: string; onExpired(): void; accent?: string }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      if (s === 0) onExpired();
      setLabel(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt, onExpired]);
  return <span className={`font-mono text-lg font-bold ${accent}`}>{label}</span>;
}

export default function SellPage() {
  const router    = useRouter();
  const [price,   setPrice]      = useState(3);
  const [winMin,  setWinMin]     = useState(60);
  const [active,  setActive]     = useState<ActiveListing | null>(null);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<string | null>(null);
  const [msg,     setMsg]        = useState('');
  const [busy,    setBusy]       = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [checking,   setChecking]   = useState(true);

  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => {
    setClosed(getClosedReason());
    const t = setInterval(() => setClosed(getClosedReason()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [pickupEnd, setPickupEnd] = useState('');
  useEffect(() => {
    setPickupEnd(
      new Date(Date.now() + winMin * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    );
  }, [winMin]);

  const checkActive = useCallback(async () => {
    try {
      const d = await jsonOrThrow<{ listings: ActiveListing[] }>(await authedFetch('/api/listings/mine'));
      setActive(d.listings?.[0] ?? null);
      setCooldownEndsAt(null); // clear cooldown if active listing found
    } catch { setActive(null); }
    finally { setChecking(false); }
  }, []);

  useEffect(() => { checkActive(); }, [checkActive]);

  const cancelActive = async () => {
    if (!active || !confirm('Cancel your current listing?')) return;
    try {
      setCancelling(true);
      await jsonOrThrow(await authedFetch(`/api/listings/${active.id}`, { method: 'DELETE' }));
      setActive(null); setMsg('');
    } catch (e: any) { setMsg(e.message); }
    finally { setCancelling(false); }
  };

  const post = async () => {
    if (closed) { setMsg(closed); return; }
    try {
      setBusy(true); setMsg('');
      const expires_at = new Date(Date.now() + winMin * 60_000).toISOString();
      await jsonOrThrow(await authedFetch('/api/listings', {
        method: 'POST',
        body:   JSON.stringify({ price_cents: Math.round(price * 100), expires_at }),
      }));
      setMsg('✅ Listed! Redirecting…');
      setTimeout(() => router.push('/board'), 800);
    } catch (e: any) {
      setMsg(e.message);
      // Parse cooldown_ends_at from error response if available
      if (e.message?.includes('active listing')) {
        checkActive();
      }
      // Try to parse a cooldown response
      try {
        const res = await authedFetch('/api/listings', {
          method: 'POST',
          body: JSON.stringify({ price_cents: Math.round(price * 100), expires_at: new Date(Date.now() + winMin * 60_000).toISOString() }),
        });
        if (res.status === 429) {
          const data = await res.json();
          if (data.cooldown_ends_at) setCooldownEndsAt(data.cooldown_ends_at);
        }
      } catch {}
    } finally { setBusy(false); }
  };

  // Smarter post that captures cooldown info
  const postWithCooldownCheck = async () => {
    if (closed) { setMsg(closed); return; }
    setBusy(true); setMsg('');
    try {
      const expires_at = new Date(Date.now() + winMin * 60_000).toISOString();
      const res = await authedFetch('/api/listings', {
        method: 'POST',
        body:   JSON.stringify({ price_cents: Math.round(price * 100), expires_at }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? `Error ${res.status}`);
        if (data.cooldown_ends_at) setCooldownEndsAt(data.cooldown_ends_at);
        if (data.active_listing_id) checkActive();
      } else {
        setMsg('✅ Listed! Redirecting…');
        setTimeout(() => router.push('/board'), 800);
      }
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  if (checking) return (
    <div className="flex justify-center p-10">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-black">➕ Sell an Ortega meal</h1>
        <p className="text-slate-400 text-sm">Post your Ortega dining QR for someone to claim</p>
      </header>

      {closed && (
        <div className="rounded-2xl border border-amber-700 bg-amber-950/30 p-4 text-center">
          <p className="text-amber-300 font-semibold text-sm">🚫 {closed}</p>
          <p className="text-slate-500 text-xs mt-1">Mon–Fri 10 AM–8 PM PT only</p>
        </div>
      )}

      {/* Seller cooldown banner */}
      {cooldownEndsAt && !active && (
        <section className="rounded-2xl border border-purple-700 bg-purple-950/20 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⏳</span>
            <div>
              <p className="text-purple-300 font-bold text-sm">Cooldown active</p>
              <p className="text-slate-400 text-xs">You must wait 90 min after completing an order before listing again.</p>
            </div>
          </div>
          <div className="flex items-center justify-between bg-purple-950/40 rounded-xl p-3">
            <span className="text-slate-400 text-sm">Cooldown ends in</span>
            <Countdown
              expiresAt={cooldownEndsAt}
              onExpired={() => { setCooldownEndsAt(null); setMsg(''); }}
              accent="text-purple-300"
            />
          </div>
          <p className="text-slate-500 text-xs">This 90-minute cooldown ensures fair access for all buyers.</p>
        </section>
      )}

      {active && (
        <section className="rounded-2xl border border-amber-700 bg-amber-950/20 p-5 space-y-3">
          <p className="text-amber-400 font-bold text-sm">⚠️ You have an active listing — ${(active.price_cents/100).toFixed(2)}</p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Expires in</span>
            <Countdown expiresAt={active.expires_at} onExpired={checkActive} />
          </div>
          <p className="text-slate-500 text-xs">You can only have one active listing at a time.</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => router.push('/board')}
              className="py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-sm font-semibold transition">
              View board
            </button>
            <button onClick={cancelActive} disabled={cancelling}
              className="py-2.5 rounded-xl border border-rose-700 text-rose-400 hover:bg-rose-950/40 text-sm font-medium disabled:opacity-50 transition">
              {cancelling ? '…' : 'Cancel listing'}
            </button>
          </div>
        </section>
      )}

      {!active && !closed && !cooldownEndsAt && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-5 space-y-5">
          {/* Price */}
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-slate-300 font-medium text-sm">Price</span>
              <span className="text-white font-black text-2xl">{price === 0 ? '🎁 Free' : `$${price.toFixed(2)}`}</span>
            </div>
            <input type="range" min={0} max={6} step={0.5} value={price}
              onChange={e => setPrice(+e.target.value)} className="w-full accent-blue-500 h-2" />
            <div className="flex justify-between text-xs text-slate-500"><span>Free</span><span>$6.00</span></div>
          </div>

          {/* Window */}
          <div className="space-y-2">
            <p className="text-slate-300 font-medium text-sm">Listing expires in</p>
            <div className="grid grid-cols-4 gap-2">
              {WINDOWS_MIN.map(m => (
                <button key={m} onClick={() => setWinMin(m)}
                  className={`py-2 rounded-xl border text-sm font-semibold transition ${winMin === m ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-400'}`}>
                  {m}m
                </button>
              ))}
            </div>
            {pickupEnd && <p className="text-xs text-slate-500">Expires at ~{pickupEnd}</p>}
          </div>

          {/* How it works */}
          <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-3 text-xs text-slate-400 space-y-1">
            <p className="font-medium text-slate-300">How it works</p>
            <p>1️⃣ Post listing → buyer claims and picks their meal</p>
            <p>2️⃣ You accept the order</p>
            <p>3️⃣ Upload your Ortega dining QR code privately</p>
            <p>4️⃣ Buyer uses QR at Ortega to pick up their food</p>
            <p className="text-purple-400">⏳ 90-min cooldown applies after each completed order</p>
          </div>

          <button disabled={busy} onClick={postWithCooldownCheck}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 font-bold text-base transition active:scale-95">
            {busy ? 'Posting…' : 'Post listing'}
          </button>
        </section>
      )}

      {msg && (
        <p className={`text-sm text-center font-medium ${msg.startsWith('✅') ? 'text-emerald-400' : 'text-rose-400'}`}>
          {msg}
        </p>
      )}
    </main>
  );
}
