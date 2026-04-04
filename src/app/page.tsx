import Link from 'next/link';
import { getClosedReason } from '@/lib/menu';

const HOW = [
  { icon: '📋', title: 'Seller posts a meal', body: 'A UCSB student with Ortega dining dollars lists what they\'re selling and sets a price.' },
  { icon: '🛒', title: 'Buyer locks the meal', body: 'Browse the live board, pick a listing, and lock it in. You have 10 min to choose your order.' },
  { icon: '🍽️', title: 'Choose your food', body: 'Select your entree, sides, fruit, and condiments from the real Ortega menu — then submit.' },
  { icon: '💸', title: 'Send payment directly', body: 'Pay the seller via Venmo, Zelle, or cash — then tap "I Sent Payment" in the app.' },
  { icon: '📲', title: 'Seller confirms & sends QR', body: 'Once the seller confirms payment, they upload their Ortega QR code — only visible to you.' },
  { icon: '🚶', title: 'Pick it up yourself', body: 'Walk to Ortega, scan the QR at the register, and grab your meal. You\'re done!' },
];

export default function HomePage() {
  const closedReason = getClosedReason();
  return (
    <div className="space-y-8 py-2">
      {/* Closed banner */}
      {closedReason && (
        <div className="rounded-2xl border border-slate-600 bg-slate-800/60 px-4 py-3 text-center text-sm text-slate-300">
          🔒 {closedReason} Come back Mon–Fri, 10 AM–8 PM PT.
        </div>
      )}
      {/* Hero */}
      <section className="text-center space-y-4 pt-2">
        <div className="text-6xl">🌮</div>
        <h1 className="text-4xl font-black text-white">GauchoGrub</h1>
        <p className="text-slate-300 text-lg max-w-xs mx-auto leading-relaxed">
          UCSB students buy & sell Ortega dining meals — easily, safely, fee-free.
        </p>
        <div className="inline-flex items-center gap-2 bg-emerald-950/60 border border-emerald-700 text-emerald-300 px-4 py-2 rounded-xl text-sm font-semibold">
          💚 0% platform fee — 100% goes to the seller
        </div>
        <div className="flex gap-3 justify-center flex-wrap pt-1">
          <Link href="/board" className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold transition active:scale-95 text-sm shadow-lg">
            Browse meals →
          </Link>
          <Link href="/sell" className="px-6 py-3 rounded-xl border border-slate-600 hover:border-slate-400 font-semibold transition text-slate-300 hover:text-white text-sm">
            Sell an Ortega meal
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="space-y-3">
        <h2 className="font-bold text-white text-lg">How it works</h2>
        <div className="space-y-2">
          {HOW.map((s, i) => (
            <div key={i} className="flex gap-3 p-4 rounded-2xl border border-slate-700 bg-slate-900/40">
              <span className="text-2xl shrink-0">{s.icon}</span>
              <div>
                <p className="font-semibold text-sm text-white">{s.title}</p>
                <p className="text-slate-400 text-sm mt-0.5 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Rules */}
      <section className="rounded-2xl border border-amber-800 bg-amber-950/20 p-5 space-y-2">
        <h2 className="text-amber-300 font-bold text-sm">📋 Important rules</h2>
        {[
          '⏰ Ortega is open Mon–Fri, 10 AM–8 PM PT only (no weekends)',
          '📲 You use the seller\'s QR code to pick up your OWN food at Ortega',
          '🔒 QR codes are private — only visible to you after claiming',
          '🚫 Never share passwords, personal info, or payment details',
          '🎓 Only @ucsb.edu Google accounts are allowed',
        ].map((r, i) => <p key={i} className="text-slate-300 text-sm">{r}</p>)}
      </section>

      {/* Trust */}
      <section className="rounded-2xl border border-emerald-800 bg-emerald-950/20 p-5 text-center space-y-2">
        <p className="text-3xl">💚</p>
        <p className="text-emerald-300 font-bold text-lg">We charge NO extra fee.</p>
        <p className="text-slate-400 text-sm">100% of what you pay goes directly to the seller. GauchoGrub makes nothing on transactions.</p>
      </section>

    </div>
  );
}
