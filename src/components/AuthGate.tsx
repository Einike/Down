"use client";
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const PUBLIC = ['/login', '/onboarding', '/dev/login', '/'];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [ready,  setReady]  = useState(false);

  useEffect(() => {
    if (PUBLIC.some(p => pathname === p || pathname?.startsWith(p + '/'))) { setReady(true); return; }
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      try {
        const res = await fetch('/api/profile', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const d   = await res.json();
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
