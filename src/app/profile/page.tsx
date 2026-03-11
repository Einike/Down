"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { authedFetch, jsonOrThrow } from '@/lib/fetcher';

type Profile    = { id: string; username: string; email: string; created_at: string };
type RepReview  = { rating: number; body: string; created_at: string; buyer_username: string };
type Reputation = {
  avg_rating: number | null; review_count: number;
  completed_count: number;   recent_reviews: RepReview[];
};
type PaymentMethod = { method: string; handle: string; is_active: boolean };

// ── Payment method display config ──────────────────────────────────────────
const PM_CONFIG: Record<string, { label: string; icon: string; prefix: string; placeholder: string; hint: string }> = {
  venmo:     { label: 'Venmo',     icon: '💙', prefix: '@',  placeholder: 'username',          hint: 'Your Venmo @username' },
  zelle:     { label: 'Zelle',     icon: '💛', prefix: '',   placeholder: 'email or phone',    hint: 'Registered email or phone number' },
  apple_pay: { label: 'Apple Pay', icon: '🍎', prefix: '',   placeholder: 'phone number',      hint: 'Phone number linked to Apple Pay' },
  paypal:    { label: 'PayPal',    icon: '🅿️', prefix: '',   placeholder: 'username or email', hint: 'PayPal @username or email address' },
  cash_app:  { label: 'Cash App',  icon: '💚', prefix: '$',  placeholder: 'cashtag',           hint: 'Your $Cashtag' },
};

const ALL_METHODS = Object.keys(PM_CONFIG) as (keyof typeof PM_CONFIG)[];

export default function ProfilePage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [rep,     setRep]     = useState<Reputation | null>(null);

  // Payment methods state
  const [methods,     setMethods]     = useState<Record<string, PaymentMethod>>({});
  const [pmLoading,   setPmLoading]   = useState(true);
  const [pmSaving,    setPmSaving]    = useState('');  // which method is saving
  const [pmErr,       setPmErr]       = useState('');
  const [pmSuccess,   setPmSuccess]   = useState('');
  // Local edits (method → handle string)
  const [handles,     setHandles]     = useState<Record<string, string>>({});
  const [enabled,     setEnabled]     = useState<Record<string, boolean>>({});

  // ── Load profile ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const d = await jsonOrThrow<{ profile: Profile }>(await authedFetch('/api/profile'));
        setProfile(d.profile);
      } catch (e: any) { setErr(e.message ?? 'Failed to load profile'); }
      finally { setLoading(false); }
    })();
  }, []);

  // ── Load reputation ───────────────────────────────────────────────────────
  useEffect(() => {
    authedFetch('/api/profile/reputation')
      .then(r => r.json())
      .then(d => { if (d.reputation) setRep(d.reputation); })
      .catch(() => {});
  }, []);

  // ── Load payment methods ──────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const d = await jsonOrThrow<{ payment_methods: PaymentMethod[] }>(
          await authedFetch('/api/payment-methods'),
        );
        const map: Record<string, PaymentMethod> = {};
        const hmap: Record<string, string>  = {};
        const emap: Record<string, boolean> = {};
        for (const pm of d.payment_methods ?? []) {
          map[pm.method]  = pm;
          hmap[pm.method] = pm.handle;
          emap[pm.method] = pm.is_active;
        }
        setMethods(map);
        setHandles(hmap);
        setEnabled(emap);
      } catch { /* non-critical */ }
      finally { setPmLoading(false); }
    })();
  }, []);

  // ── Save a single payment method ──────────────────────────────────────────
  const saveMethod = async (method: string) => {
    const handle    = (handles[method] ?? '').trim();
    const is_active = enabled[method] ?? false;

    if (is_active && !handle) {
      setPmErr(`Please enter a handle for ${PM_CONFIG[method].label}`);
      return;
    }
    setPmErr(''); setPmSuccess('');

    try {
      setPmSaving(method);
      if (!is_active && !methods[method]) {
        // Nothing to save — method was never set up and is toggled off
        return;
      }
      if (!is_active && methods[method] && !handle) {
        // Delete the method
        await authedFetch(`/api/payment-methods?method=${method}`, { method: 'DELETE' });
        setMethods(prev => { const n = { ...prev }; delete n[method]; return n; });
      } else {
        await jsonOrThrow(await authedFetch('/api/payment-methods', {
          method: 'POST',
          body: JSON.stringify({ method, handle, is_active }),
        }));
        setMethods(prev => ({ ...prev, [method]: { method, handle, is_active } }));
      }
      setPmSuccess(`${PM_CONFIG[method].label} saved!`);
      setTimeout(() => setPmSuccess(''), 3000);
    } catch (e: any) {
      setPmErr(e.message ?? 'Failed to save');
    } finally {
      setPmSaving('');
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (loading) return (
    <div className="flex justify-center p-10">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const activeMethodCount = Object.values(methods).filter(m => m.is_active).length;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black">👤 Profile</h1>
      {err && <p className="text-rose-400 text-sm">{err}</p>}

      {profile && (
        <>
          {/* ── Identity card ────────────────────────────────────────── */}
          <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-6 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-blue-900/40 border border-blue-700 flex items-center justify-center text-3xl mx-auto">🌮</div>
            <div>
              <p className="text-xl font-black text-white">@{profile.username}</p>
              <p className="text-slate-400 text-sm">{profile.email}</p>
            </div>
            <p className="text-slate-600 text-xs">
              Member since {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </p>
          </section>

          {/* ── Payment Methods ──────────────────────────────────────── */}
          <section className="rounded-2xl border border-slate-700 bg-slate-900/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <div>
                <p className="font-semibold text-white text-sm">💳 Payment Methods</p>
                <p className="text-slate-500 text-xs mt-0.5">
                  Buyers see these when purchasing your meals.
                  {activeMethodCount > 0 ? ` ${activeMethodCount} active method${activeMethodCount !== 1 ? 's' : ''}.` : ' Set up at least one!'}
                </p>
              </div>
            </div>

            {pmLoading ? (
              <div className="flex justify-center p-6">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {activeMethodCount === 0 && (
                  <div className="rounded-xl border border-amber-700 bg-amber-950/20 p-3 text-sm">
                    <p className="text-amber-300 font-semibold">⚠️ No payment methods set up</p>
                    <p className="text-amber-200/70 text-xs mt-0.5">Buyers won't know where to send money. Add at least one method below.</p>
                  </div>
                )}

                {pmErr   && <p className="text-rose-400 text-sm">{pmErr}</p>}
                {pmSuccess && <p className="text-emerald-400 text-sm">✓ {pmSuccess}</p>}

                {ALL_METHODS.map(method => {
                  const cfg       = PM_CONFIG[method];
                  const isEnabled = enabled[method] ?? false;
                  const isSaving  = pmSaving === method;
                  const existing  = methods[method];
                  const handle    = handles[method] ?? '';
                  const changed   = handle !== (existing?.handle ?? '') || isEnabled !== (existing?.is_active ?? false);

                  return (
                    <div key={method}
                      className={`rounded-xl border transition ${isEnabled ? 'border-slate-600 bg-slate-800/40' : 'border-slate-800 bg-slate-900/20 opacity-60'}`}>
                      {/* Header row */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <span className="text-xl">{cfg.icon}</span>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{cfg.label}</p>
                          {existing?.is_active && !isEnabled && (
                            <p className="text-xs text-slate-500">Currently active — toggle to keep enabled</p>
                          )}
                        </div>
                        {/* Toggle */}
                        <button
                          onClick={() => setEnabled(prev => ({ ...prev, [method]: !isEnabled }))}
                          className={`relative w-11 h-6 rounded-full transition-colors ${isEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
                          aria-label={`Toggle ${cfg.label}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>

                      {/* Handle input (shown when enabled) */}
                      {isEnabled && (
                        <div className="px-4 pb-4 space-y-2">
                          <p className="text-xs text-slate-500">{cfg.hint}</p>
                          <div className="flex gap-2">
                            {cfg.prefix && (
                              <span className="flex items-center px-3 bg-slate-700 border border-slate-600 rounded-l-xl text-slate-400 text-sm border-r-0">
                                {cfg.prefix}
                              </span>
                            )}
                            <input
                              type="text"
                              value={handle}
                              onChange={e => setHandles(prev => ({ ...prev, [method]: e.target.value }))}
                              placeholder={cfg.placeholder}
                              maxLength={100}
                              className={`flex-1 bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 focus:outline-none focus:border-blue-500
                                ${cfg.prefix ? 'rounded-r-xl rounded-l-none' : 'rounded-xl'}`}
                            />
                          </div>
                          {(changed || !existing) && (
                            <button
                              disabled={isSaving || !handle.trim()}
                              onClick={() => saveMethod(method)}
                              className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold transition">
                              {isSaving ? '…' : '✓ Save'}
                            </button>
                          )}
                          {!changed && existing && (
                            <p className="text-emerald-400 text-xs text-center">✓ Saved</p>
                          )}
                        </div>
                      )}

                      {/* Remove button (when toggled off but previously saved) */}
                      {!isEnabled && existing && (
                        <div className="px-4 pb-3">
                          <button
                            disabled={isSaving}
                            onClick={() => saveMethod(method)}
                            className="text-xs text-rose-500 hover:text-rose-400 transition">
                            {isSaving ? '…' : '✕ Remove saved handle'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Seller reputation ─────────────────────────────────────── */}
          {rep && (
            <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-300">⭐ Seller reputation</p>
              {rep.review_count === 0 ? (
                <p className="text-slate-500 text-sm">No reviews yet — complete a sale to start building trust.</p>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-yellow-400 text-2xl tracking-wide leading-none">
                      {'★'.repeat(Math.round(rep.avg_rating ?? 0))}{'☆'.repeat(5 - Math.round(rep.avg_rating ?? 0))}
                    </span>
                    <span className="text-white font-bold text-xl">{rep.avg_rating?.toFixed(1)}</span>
                    <span className="text-slate-500 text-sm">/ 5</span>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <div className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-center min-w-[72px]">
                      <p className="text-white font-bold">{rep.review_count}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{rep.review_count === 1 ? 'review' : 'reviews'}</p>
                    </div>
                    <div className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-center min-w-[72px]">
                      <p className="text-white font-bold">{rep.completed_count}</p>
                      <p className="text-slate-500 text-xs mt-0.5">sales done</p>
                    </div>
                  </div>
                  {rep.recent_reviews.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-xs text-slate-500 uppercase tracking-widest">Recent feedback</p>
                      {rep.recent_reviews.map((r, i) => (
                        <div key={i} className="rounded-xl bg-slate-800/60 border border-slate-700 p-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-yellow-400 text-sm">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                            <span className="text-slate-500 text-xs">@{r.buyer_username} · {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>
                          {r.body && <p className="text-slate-300 text-sm italic">"{r.body}"</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <button onClick={signOut}
            className="w-full py-3 rounded-xl border border-rose-800 text-rose-400 hover:bg-rose-950/30 font-medium text-sm transition">
            Sign out
          </button>

          <a href="/admin/audit"
            className="block w-full py-3 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 font-medium text-sm transition text-center">
            📊 Admin Audit Dashboard
          </a>
        </>
      )}
    </div>
  );
}
