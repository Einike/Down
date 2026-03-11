"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/board');
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) router.replace('/board');
    });
    return () => subscription.unsubscribe();
  }, [router]);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/board` },
    });
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-slate-950">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <div className="text-6xl">🌮</div>
          <h1 className="text-3xl font-black text-white">GauchoGrub</h1>
          <p className="text-slate-400">UCSB Ortega dining marketplace</p>
        </div>

        <div className="space-y-3">
          <button onClick={signIn}
            className="w-full flex items-center justify-center gap-3 py-3 px-5 rounded-xl bg-white text-slate-900 font-semibold hover:bg-slate-100 transition active:scale-95 shadow">
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Sign in with Google
          </button>
          <p className="text-slate-500 text-sm">Use your <strong className="text-slate-300">@ucsb.edu</strong> account</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 text-left space-y-1.5 text-xs text-slate-500">
          <p className="text-slate-300 font-medium text-sm mb-2">How it works</p>
          <p>📋 Sellers post available Ortega meals</p>
          <p>🛒 Buyers claim and customize their order</p>
          <p>📲 Seller shares QR code privately</p>
          <p>🍽️ Buyer uses QR to pick up food at Ortega</p>
          <p className="text-emerald-400 font-medium mt-1">💚 0% platform fee</p>
        </div>

        {process.env.NEXT_PUBLIC_APP_ENV !== 'production' && (
          <a href="/dev/login" className="block text-slate-600 hover:text-slate-400 text-xs transition">
            🧪 Dev login
          </a>
        )}
      </div>
    </main>
  );
}
