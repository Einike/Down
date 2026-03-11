"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { authedFetch, jsonOrThrow } from '@/lib/fetcher';

type Profile    = { id: string; username: string; email: string; created_at: string };
type RepReview  = { rating: number; body: string; created_at: string; buyer_username: string };
type Reputation = {
  avg_rating:      number | null;
  review_count:    number;
  completed_count: number;
  recent_reviews:  RepReview[];
};

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [rep,     setRep]     = useState<Reputation | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await jsonOrThrow<{ profile: Profile }>(await authedFetch('/api/profile'));
        setProfile(d.profile);
      } catch (e: any) { setErr(e.message ?? 'Failed to load profile'); }
      finally { setLoading(false); }
    })();
  }, []);

  // Reputation loads independently — non-critical, page still usable if it fails.
  useEffect(() => {
    authedFetch('/api/profile/reputation')
      .then(r => r.json())
      .then(d => { if (d.reputation) setRep(d.reputation); })
      .catch(() => {});
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (loading) return (
    <div className="flex justify-center p-10">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black">👤 Profile</h1>

      {err && <p className="text-rose-400 text-sm">{err}</p>}

      {profile && (
        <>
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

          <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Username</span>
              <span className="font-mono text-white">@{profile.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Email</span>
              <span className="text-slate-300">{profile.email}</span>
            </div>
          </section>

          {/* ── Seller reputation ──────────────────────────────── */}
          {rep && (
            <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-300">⭐ Seller reputation</p>

              {rep.review_count === 0 ? (
                <p className="text-slate-500 text-sm">No reviews yet — complete a sale to start building trust.</p>
              ) : (
                <>
                  {/* Summary row */}
                  <div className="flex items-center gap-3">
                    <span className="text-yellow-400 text-2xl tracking-wide leading-none">
                      {'★'.repeat(Math.round(rep.avg_rating ?? 0))}{'☆'.repeat(5 - Math.round(rep.avg_rating ?? 0))}
                    </span>
                    <span className="text-white font-bold text-xl">{rep.avg_rating?.toFixed(1)}</span>
                    <span className="text-slate-500 text-sm">/ 5</span>
                  </div>

                  {/* Stat chips */}
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

                  {/* Recent written reviews */}
                  {rep.recent_reviews.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-xs text-slate-500 uppercase tracking-widest">Recent feedback</p>
                      {rep.recent_reviews.map((r, i) => (
                        <div key={i} className="rounded-xl bg-slate-800/60 border border-slate-700 p-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-yellow-400 text-sm">
                              {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                            </span>
                            <span className="text-slate-500 text-xs">
                              @{r.buyer_username} · {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          </div>
                          <p className="text-slate-300 text-sm italic">"{r.body}"</p>
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
