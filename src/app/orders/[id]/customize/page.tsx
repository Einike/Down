"use client";
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authedFetch, jsonOrThrow } from '@/lib/fetcher';
import {
  getAvailableEntrees, SIDES, DESSERTS, FRUITS,
  BEVERAGES, CONDIMENTS, getMealPeriod, OrderItems,
} from '@/lib/menu';

export default function CustomizePage() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const period   = getMealPeriod();
  const entrees  = getAvailableEntrees(period);

  const [entree,     setEntree]     = useState('');
  const [side,       setSide]       = useState('');
  const [dessert,    setDessert]    = useState('');
  // fruits is a multiset — duplicates allowed (two bananas = ['Banana (vgn)', 'Banana (vgn)'])
  const [fruits,     setFruits]     = useState<string[]>([]);
  const [beverage,   setBeverage]   = useState('');
  const [condiments, setCondiments] = useState<string[]>([]);
  const [notes,      setNotes]      = useState('');
  const [busy,       setBusy]       = useState(false);
  const [err,        setErr]        = useState('');

  const maxFruits = dessert ? 1 : 2;

  // Count occurrences in the multiset
  const fruitCount = (f: string) => fruits.filter(x => x === f).length;

  const toggleCondiment = (c: string) =>
    setCondiments(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  // Add one fruit to multiset
  const addFruit = (f: string) => {
    if (fruits.length >= maxFruits) {
      setErr(`Max ${maxFruits} fruit${maxFruits > 1 ? 's' : ''} allowed`);
      return;
    }
    setErr('');
    setFruits(prev => [...prev, f]);
  };

  // Remove one occurrence of a fruit from multiset
  const removeFruit = (f: string) => {
    setErr('');
    setFruits(prev => {
      const idx = prev.lastIndexOf(f);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  };

  useEffect(() => {
    // If dessert chosen and already have 2 fruits, drop one
    if (dessert && fruits.length > 1) setFruits(prev => prev.slice(0, 1));
  }, [dessert]);

  if (period === 'closed') return (
    <main className="p-6 text-center space-y-3">
      <div className="text-4xl">🚫</div>
      <h1 className="text-xl font-bold text-white">Ortega is currently closed</h1>
      <p className="text-slate-400 text-sm">Hours: Mon–Fri 10am–8pm (PT)</p>
      <button onClick={() => router.back()} className="text-blue-400 text-sm">← Go back</button>
    </main>
  );

  const submit = async () => {
    if (!entree) { setErr('Please select an entree'); return; }
    const items: OrderItems = {
      entree, side: side || null, dessert: dessert || null,
      fruits, beverage: beverage || null, condiments, notes: notes || null,
    };
    try {
      setBusy(true); setErr('');
      await jsonOrThrow(await authedFetch(`/api/orders/${id}/customize`, {
        method: 'POST', body: JSON.stringify(items),
      }));
      // Navigate away — do NOT bounce back to /customize
      router.push(`/orders/${id}`);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // Build display list: unique fruits with their counts
  const uniqueFruits = Array.from(new Set(fruits));

  return (
    <main className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-bold">🍽️ Customize Your Order</h1>
        <p className="text-slate-400 text-sm capitalize">{period} menu • Ortega Dining</p>
      </header>

      {/* ENTREE */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="font-semibold text-white">Entree <span className="text-rose-400 text-xs">required</span></h2>
        <div className="space-y-2">
          {entrees.map(e => (
            <label key={e} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${entree === e ? 'border-blue-500 bg-blue-950/30' : 'border-slate-700 hover:border-slate-500'}`}>
              <input type="radio" name="entree" value={e} checked={entree === e}
                onChange={() => setEntree(e)} className="accent-blue-500" />
              <span className="text-sm text-slate-200">{e}</span>
            </label>
          ))}
        </div>
      </section>

      {/* SIDE */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="font-semibold text-white">Side <span className="text-slate-500 text-xs">optional, max 1</span></h2>
        <select value={side} onChange={e => setSide(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm">
          <option value="">— No side —</option>
          {SIDES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </section>

      {/* DESSERT */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="font-semibold text-white">Dessert <span className="text-slate-500 text-xs">optional · limits fruit to 1</span></h2>
        <select value={dessert} onChange={e => setDessert(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm">
          <option value="">— No dessert —</option>
          {DESSERTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </section>

      {/* FRUIT — multiset with +/- controls */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="font-semibold text-white">
          Fruit <span className="text-slate-500 text-xs">optional · max {maxFruits} · duplicates allowed</span>
        </h2>
        <div className="space-y-2">
          {FRUITS.map(f => {
            const count = fruitCount(f);
            return (
              <div key={f} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-700">
                <span className="text-sm text-slate-200 flex-1">{f}</span>
                <div className="flex items-center gap-2">
                  {count > 0 && (
                    <button type="button" onClick={() => removeFruit(f)}
                      className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold flex items-center justify-center transition">
                      −
                    </button>
                  )}
                  {count > 0 && (
                    <span className="text-sm text-emerald-400 font-semibold min-w-[1.5rem] text-center">
                      ×{count}
                    </span>
                  )}
                  <button type="button" onClick={() => addFruit(f)}
                    disabled={fruits.length >= maxFruits}
                    className="w-7 h-7 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold flex items-center justify-center transition">
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {uniqueFruits.length > 0 && (
          <p className="text-emerald-400 text-xs">
            {uniqueFruits.map(f => {
              const c = fruitCount(f);
              return c > 1 ? `${f} ×${c}` : f;
            }).join(', ')} selected
          </p>
        )}
      </section>

      {/* BEVERAGE */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="font-semibold text-white">Beverage <span className="text-slate-500 text-xs">optional</span></h2>
        <select value={beverage} onChange={e => setBeverage(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm">
          <option value="">— No beverage —</option>
          {BEVERAGES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </section>

      {/* CONDIMENTS */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="font-semibold text-white">Condiments <span className="text-slate-500 text-xs">optional · unlimited</span></h2>
        <div className="flex gap-2 flex-wrap">
          {CONDIMENTS.map(c => (
            <button key={c} type="button" onClick={() => toggleCondiment(c)}
              className={`px-3 py-2 rounded-xl border text-sm transition ${condiments.includes(c) ? 'bg-amber-700 border-amber-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-400'}`}>
              {c}
            </button>
          ))}
        </div>
      </section>

      {/* NOTES */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <h2 className="font-semibold text-white">Notes <span className="text-slate-500 text-xs">optional</span></h2>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Allergies, special requests..."
          className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
      </section>

      {err && <p className="text-rose-400 text-sm text-center">{err}</p>}

      <button disabled={busy || !entree} onClick={submit}
        className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-bold text-lg transition active:scale-95">
        {busy ? 'Submitting...' : 'Confirm Order →'}
      </button>
    </main>
  );
}
