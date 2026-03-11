"use client";
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authedFetch } from '@/lib/fetcher';
import { supabase } from '@/lib/supabaseClient';

type N = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const TYPE_ICON: Record<string, string> = {
  order_claimed:     '🛒',
  order_cancelled:   '❌',
  order_completed:   '✅',
  listing_reopened:  '🔄',
  review_received:   '⭐',
};

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotifBell() {
  const [list,     setList]     = useState<N[]>([]);
  const [open,     setOpen]     = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const ref    = useRef<HTMLDivElement>(null);
  const unread = list.filter(n => !n.read_at).length;

  // Only poll when we have an active session — eliminates 401 spam
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setLoggedIn(!!session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setLoggedIn(!!s);
      if (!s) setList([]);
    });
    return () => subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch('/api/notifications');
      if (!res.ok) return;
      const d = await res.json();
      setList(d.notifications ?? []);
    } catch {}
  }, []);

  // Smart polling: 15s when unreads exist, 30s when all read
  useEffect(() => {
    if (!loggedIn) { setList([]); return; }
    load();
    const interval = setInterval(load, unread > 0 ? 15_000 : 30_000);
    return () => clearInterval(interval);
  }, [loggedIn, unread, load]);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  const markAllRead = async () => {
    await authedFetch('/api/notifications', { method: 'PATCH' }).catch(() => {});
    setList(p => p.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  };

  const markOneRead = async (id: string) => {
    setList(p => p.map(n => n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n));
    await authedFetch(`/api/notifications/${id}`, { method: 'PATCH' }).catch(() => {});
  };

  if (!loggedIn) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl hover:bg-slate-800 transition"
        aria-label="Notifications"
      >
        <span className="text-xl leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold px-0.5">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <span className="font-semibold text-sm">Notifications</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-blue-400 hover:text-blue-300 transition"
                >
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
            {list.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">No notifications yet</p>
            ) : (
              list.map(n => {
                const icon = TYPE_ICON[n.type] ?? '🔔';
                const isUnread = !n.read_at;
                const inner = (
                  <div className={`px-4 py-3 flex gap-3 items-start transition hover:bg-slate-800/50 ${isUnread ? 'bg-blue-950/20' : ''}`}>
                    <span className="text-lg leading-none mt-0.5 shrink-0">{icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${isUnread ? 'font-semibold text-white' : 'font-medium text-slate-200'}`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{n.body}</p>
                      <p className="text-[10px] text-slate-600 mt-1">{ago(n.created_at)}</p>
                    </div>
                    {isUnread && (
                      <span className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                );

                return n.link ? (
                  <Link
                    key={n.id}
                    href={n.link}
                    onClick={() => { markOneRead(n.id); setOpen(false); }}
                    className="block"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id} onClick={() => markOneRead(n.id)} className="cursor-default">
                    {inner}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
