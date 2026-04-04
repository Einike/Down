"use client";
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const PUBLIC = ['/login', '/onboarding', '/'];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [ready,  setReady]  = useState(false);

  useEffect(() => {
    if (PUBLIC.some(p => pathname === p || pathname?.startsWith(p + '/'))) { setReady(true); return; }
    (async () => {
      let { data: { session } } = await supabase.auth.getSession();

      // Refresh if expired or about to expire — handles mobile backgrounding
      if (session) {
        const expiresAt = session.expires_at ?? 0;
        const nowSecs   = Math.floor(Date.now() / 1000);
        if (expiresAt - nowSecs < 60) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed.session) {
            session = refreshed.session;
          } else if (expiresAt < nowSecs) {
            // Token is fully expired and refresh failed — must re-login
            router.replace('/login'); return;
          }
        }
      }

      if (!session) { router.replace('/login'); return; }
      try {
        const res = await fetch('/api/profile', { headers: { Authorization: `Bearer ${session.access_token}` } });
        // Non-2xx means auth failed (expired/invalid token) — send to login, NOT onboarding
        if (!res.ok) { router.replace('/login'); return; }
        const d = await res.json();
        if (!d.profile?.username) { router.replace('/onboarding'); return; }
      } catch { router.replace('/login'); return; }
      setReady(true);
    })();
  }, [pathname, router]);

  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  return <>{children}</>;
}
