"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

const ACCOUNTS = [
  { label: '🛒 Seller',   email: 'seller_test@ucsb.edu' },
  { label: '👤 Buyer 1',  email: 'buyer_test@ucsb.edu'  },
  { label: '👤 Buyer 2',  email: 'buyer2_test@ucsb.edu' },
];

export default function DevLoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [err,  setErr]  = useState('');

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_APP_ENV === 'production') router.replace('/login');
  }, [router]);

  if (process.env.NEXT_PUBLIC_APP_ENV === 'production') return null;

  const login = async (email: string) => {
    setBusy(email); setErr('');
    try {
      const res = await fetch('/api/dev/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ email, password: 'TestPass123!' }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? 'Login failed'); return; }
      const sb = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      await sb.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token });
      router.push('/board');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-1">
          <div className="text-4xl">🧪</div>
          <h1 className="text-2xl font-bold text-white">Dev Login</h1>
          <p className="text-amber-400 text-sm">⚠️ Development only</p>
        </div>
        <div className="space-y-2">
          {ACCOUNTS.map(a => (
            <button key={a.email} disabled={!!busy} onClick={() => login(a.email)}
              className="w-full py-3 px-4 rounded-xl bg-slate-800 border border-slate-600 hover:border-slate-400 text-left transition disabled:opacity-50">
              <div className="font-medium text-white">{a.label}</div>
              <div className="text-slate-400 text-xs">{a.email}</div>
              {busy === a.email && <div className="text-blue-400 text-xs mt-0.5">Signing in…</div>}
            </button>
          ))}
        </div>
        {err && <p className="text-rose-400 text-sm text-center">{err}</p>}
        <p className="text-slate-600 text-xs text-center">Run <code className="text-slate-400">npm run seed</code> first</p>
      </div>
    </main>
  );
}
