"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetch, jsonOrThrow } from '@/lib/fetcher';

export default function OnboardingPage() {
  const router   = useRouter();
  const [uname,  setUname]  = useState('');
  const [err,    setErr]    = useState('');
  const [busy,   setBusy]   = useState(false);

  const submit = async () => {
    const trimmed = uname.trim().toLowerCase();
    if (!trimmed) { setErr('Username is required'); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(trimmed)) {
      setErr('3–20 chars, lowercase letters / numbers / underscore only');
      return;
    }
    try {
      setBusy(true); setErr('');
      await jsonOrThrow(await authedFetch('/api/onboarding', {
        method: 'POST', body: JSON.stringify({ username: trimmed }),
      }));
      router.push('/board');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="text-5xl">🌮</div>
        <div>
          <h1 className="text-2xl font-bold text-white">Welcome to GauchoGrub</h1>
          <p className="text-slate-400 text-sm mt-1">Pick a username to finish setting up</p>
        </div>
        <div className="space-y-3 text-left">
          <input value={uname} onChange={e => setUname(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="e.g. gaucho42"
            maxLength={20}
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
          />
          {err && <p className="text-rose-400 text-sm">{err}</p>}
          <button disabled={busy} onClick={submit}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 font-bold transition">
            {busy ? 'Saving…' : 'Continue →'}
          </button>
        </div>
        <p className="text-slate-600 text-xs">Only @ucsb.edu accounts can use GauchoGrub</p>
      </div>
    </main>
  );
}
