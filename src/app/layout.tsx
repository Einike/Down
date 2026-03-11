import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import NotifBell from '@/components/NotifBell';

export const metadata: Metadata = {
  title:       'GauchoGrub — UCSB Ortega Marketplace',
  description: 'Buy and sell Ortega dining meals at UCSB. No fees.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white min-h-screen antialiased">
        <AuthGate>
          <header className="max-w-xl mx-auto px-4 pt-3 pb-1 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition">
              <span className="text-lg">🌮</span>
              <span className="font-bold text-white text-sm">GauchoGrub</span>
            </Link>
            <NotifBell />
          </header>

          <main className="max-w-xl mx-auto px-4 py-3 pb-28">
            {children}
          </main>

          <nav className="fixed bottom-0 inset-x-0 bg-slate-900/95 backdrop-blur border-t border-slate-700 z-40">
            <div className="max-w-xl mx-auto grid grid-cols-4">
              {[
                { href: '/board',        icon: '🏠', label: 'Board'   },
                { href: '/sell',         icon: '➕', label: 'Sell'    },
                { href: '/orders',       icon: '📦', label: 'Orders'  },
                { href: '/profile',      icon: '👤', label: 'Profile' },
              ].map(({ href, icon, label }) => (
                <Link key={href} href={href}
                  className="flex flex-col items-center gap-0.5 py-3 text-slate-400 hover:text-white transition-colors text-xs">
                  <span className="text-xl leading-none">{icon}</span>
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </nav>
        </AuthGate>
      </body>
    </html>
  );
}
