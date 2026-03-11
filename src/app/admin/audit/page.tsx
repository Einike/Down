"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetch } from '@/lib/fetcher';
import { supabase } from '@/lib/supabaseClient';

type HealthStatus = 'ok' | 'warn' | 'error';
type Health = { label: string; status: HealthStatus; detail: string };
type AuditRow = { id: string; action: string; entity_type: string | null; entity_id: string | null; metadata: any; created_at: string; username: string };
type OrderRow = { id: string; status: string; amount_cents: number; created_at: string; updated_at: string; buyer_username: string; seller_username: string; has_order_items: boolean; is_stale: boolean; lock_expired: boolean };
type DayRow = { date: string; orders: number; completions: number; listings: number };
type TopUser = { username: string; completed: number; revenue?: number; spent?: number };
type CooldownSeller = { seller_id: string; username: string; completed_at: string; cooldown_ends: string };
interface AuditData {
  generated_at: string; users: { total: number; new_24h: number };
  listings: Record<string, number>; orders: Record<string, number>;
  revenue: { total_cents: number; avg_order_cents: number; completed_orders: number; conversion_rate: number };
  activity_24h: { new_listings: number; new_orders: number; completions: number };
  daily: DayRow[]; health: Health[];
  top_sellers: TopUser[]; top_buyers: TopUser[];
  recent_orders: OrderRow[]; recent_audit: AuditRow[];
  cooldown_sellers: CooldownSeller[];
}

const fmt$ = (c: number) => `$${(c / 100).toFixed(2)}`;
function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function cooldownRemaining(endsAt: string) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return null;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
const SC: Record<string, string> = {
  LOCKED: 'bg-amber-500/20 text-amber-300 border-amber-700/50',
  BUYER_SUBMITTED: 'bg-blue-500/20 text-blue-300 border-blue-700/50',
  SELLER_ACCEPTED: 'bg-purple-500/20 text-purple-300 border-purple-700/50',
  QR_UPLOADED: 'bg-emerald-500/20 text-emerald-300 border-emerald-700/50',
  COMPLETED: 'bg-green-500/20 text-green-300 border-green-700/50',
  CANCELLED: 'bg-slate-500/20 text-slate-400 border-slate-600/50',
};
const SD: Record<string, string> = {
  LOCKED: 'bg-amber-400', BUYER_SUBMITTED: 'bg-blue-400', SELLER_ACCEPTED: 'bg-purple-400',
  QR_UPLOADED: 'bg-emerald-400', COMPLETED: 'bg-green-400', CANCELLED: 'bg-slate-500',
};
const AC: Record<string, string> = {
  'listing.create': 'text-emerald-400', 'order.claim': 'text-blue-400',
  'order.accept': 'text-purple-400', 'order.qr_upload': 'text-amber-400',
  'order.complete': 'text-green-300', 'order.cancel': 'text-rose-400',
  'admin.force_cancel': 'text-red-300',
};

function Spinner({ sm }: { sm?: boolean }) {
  return <div className={`${sm ? 'w-4 h-4 border' : 'w-6 h-6 border-2'} border-blue-500 border-t-transparent rounded-full animate-spin`} />;
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{children}</h2>;
}
function KpiCard({ label, value, sub, color = 'text-white' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-1.5">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</p>
      <p className={`text-2xl font-black leading-none ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-600">{sub}</p>}
    </div>
  );
}
function HealthRow({ h }: { h: Health }) {
  const cfg = {
    ok:    { ring: 'border-emerald-900/60 bg-emerald-950/20', dot: 'bg-emerald-400',              text: 'text-emerald-300', badge: 'OK'   },
    warn:  { ring: 'border-amber-900/60 bg-amber-950/20',     dot: 'bg-amber-400 animate-pulse',  text: 'text-amber-300',  badge: 'WARN' },
    error: { ring: 'border-red-900/60 bg-red-950/20',         dot: 'bg-red-400 animate-pulse',    text: 'text-red-300',    badge: 'ERR'  },
  }[h.status];
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${cfg.ring}`}>
      <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${cfg.dot}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${cfg.text}`}>{h.label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{h.detail}</p>
      </div>
      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md ${cfg.ring} ${cfg.text} border`}>{cfg.badge}</span>
    </div>
  );
}
function FunnelBar({ label, val, max, color }: { label: string; val: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((val / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-40 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-400 w-7 text-right">{val}</span>
      <span className="text-[10px] text-slate-600 w-8">{pct}%</span>
    </div>
  );
}
function Sparkline({ data, color = '#3b82f6' }: { data: number[]; color?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1); const w = 120; const h = 32;
  const step = w / (data.length - 1 || 1);
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * (h - 4)}`).join(' ');
  return <svg width={w} height={h} className="overflow-visible"><polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={pts} /></svg>;
}
function CooldownTimer({ endsAt }: { endsAt: string }) {
  const [label, setLabel] = useState(cooldownRemaining(endsAt) ?? 'Expired');
  useEffect(() => {
    const t = setInterval(() => setLabel(cooldownRemaining(endsAt) ?? 'Expired'), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  return <span className="font-mono text-orange-300 text-xs">{label}</span>;
}
function ForceCancelModal({ orderId, onClose, onDone }: { orderId: string; onClose(): void; onDone(): void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async () => {
    if (!reason.trim()) { setErr('Reason required'); return; }
    setBusy(true); setErr('');
    try {
      const res = await authedFetch(`/api/admin/orders/${orderId}/force-cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? 'Failed'); return; }
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-red-300">⚠️ Force Cancel Order</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <p className="text-slate-400 text-sm">
          Order <code className="font-mono text-xs bg-slate-800 px-1 rounded">#{orderId.slice(0, 8).toUpperCase()}</code> will be cancelled and both parties notified.
        </p>
        <div className="space-y-1.5">
          <label className="text-xs text-slate-400 font-medium">Reason (required)</label>
          <input type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Seller unresponsive for 3+ hours"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-500" />
        </div>
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-slate-700 text-slate-400 text-sm hover:text-white transition">Cancel</button>
          <button onClick={submit} disabled={busy || !reason.trim()}
            className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
            {busy ? <Spinner sm /> : '🚫 Force Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

type Tab = 'overview' | 'orders' | 'cooldowns' | 'log' | 'users';

export default function AuditPage() {
  const router = useRouter();
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [forceCancelId, setForceCancelId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const toastRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = (msg: string) => {
    setToast(msg); clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 4000);
  };
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError('');
    try {
      const res = await authedFetch('/api/admin/audit');
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
      setData(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      load();
    });
  }, [load, router]);
  useEffect(() => { const t = setInterval(() => load(true), 60_000); return () => clearInterval(t); }, [load]);

  const handleExport = async () => {
    try {
      const res = await authedFetch('/api/admin/export');
      if (!res.ok) { showToast('Export failed'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `gauchogrub-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch { showToast('Export failed'); }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0a0c10] flex items-center justify-center">
      <div className="text-center space-y-3"><div className="text-3xl">🌮</div><Spinner /><p className="text-slate-500 text-sm">Loading audit data…</p></div>
    </div>
  );
  if (error) return (
    <div className="min-h-screen bg-[#0a0c10] flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <p className="text-4xl">⚠️</p>
        <p className="text-rose-400 font-semibold text-sm">{error}</p>
        <button onClick={() => load()} className="px-4 py-2 text-sm rounded-xl bg-slate-800 hover:bg-slate-700 transition">Retry</button>
      </div>
    </div>
  );
  if (!data) return null;

  const d = data;
  const orderTotal = Math.max(d.orders.total, 1);
  const filteredLog = logFilter ? d.recent_audit.filter(r => r.action.includes(logFilter) || r.username.includes(logFilter)) : d.recent_audit;
  const alertCount = d.health.filter(h => h.status !== 'ok').length;

  return (
    <div className="min-h-screen bg-[#0a0c10] text-white">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 border border-slate-600 text-white text-sm px-5 py-3 rounded-xl shadow-2xl">{toast}</div>
      )}
      {forceCancelId && (
        <ForceCancelModal orderId={forceCancelId} onClose={() => setForceCancelId(null)}
          onDone={() => { setForceCancelId(null); showToast('✅ Order force-cancelled'); load(true); }} />
      )}

      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0c10]/95 backdrop-blur border-b border-slate-800/80">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => router.push('/board')} className="text-slate-500 hover:text-slate-200 text-sm transition shrink-0">← App</button>
            <div className="w-px h-4 bg-slate-800" />
            <div className="min-w-0">
              <h1 className="text-sm font-black text-white tracking-tight">🌮 GauchoGrub Admin</h1>
              <p className="text-[10px] text-slate-600">Updated {ago(d.generated_at)}</p>
            </div>
            {alertCount > 0 && (
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-900/50 border border-amber-700/50 text-amber-300 text-[10px] font-bold">
                {alertCount} alert{alertCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => router.push('/admin/reports')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-900/40 border border-rose-800 hover:bg-rose-900/60 text-xs text-rose-300 transition">🚨 Reports</button>
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition">⬇ CSV</button>
            <button onClick={() => load(true)} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs text-slate-300 transition">
              {refreshing ? <Spinner sm /> : '↻'}<span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex gap-0 border-t border-slate-800/50">
          {([
            { key: 'overview',  label: 'Overview' },
            { key: 'orders',    label: 'Orders' },
            { key: 'cooldowns', label: `Cooldowns${d.cooldown_sellers.length > 0 ? ` (${d.cooldown_sellers.length})` : ''}` },
            { key: 'log',       label: 'Audit Log' },
            { key: 'users',     label: 'Users' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-xs font-semibold transition border-b-2 whitespace-nowrap ${tab === t.key ? 'border-blue-500 text-blue-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <>
            <section className="space-y-3">
              <SectionLabel>System Health</SectionLabel>
              <div className="grid sm:grid-cols-2 gap-2">{d.health.map((h, i) => <HealthRow key={i} h={h} />)}</div>
            </section>
            <section className="space-y-3">
              <SectionLabel>Key Numbers</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Total Users"     value={d.users.total}                sub={`+${d.users.new_24h} today`}                color="text-blue-300" />
                <KpiCard label="Gross Volume"    value={fmt$(d.revenue.total_cents)}  sub={`${d.revenue.completed_orders} completed`}   color="text-green-300" />
                <KpiCard label="Avg Order"       value={fmt$(d.revenue.avg_order_cents)} sub={`${d.revenue.conversion_rate}% conversion`} color="text-emerald-300" />
                <KpiCard label="Active Listings" value={(d.listings.open ?? 0) + (d.listings.locked ?? 0)} sub="open + locked" color="text-amber-300" />
              </div>
            </section>
            <section className="space-y-3">
              <SectionLabel>Last 24 Hours</SectionLabel>
              <div className="grid grid-cols-3 gap-3">
                <KpiCard label="New Listings" value={d.activity_24h.new_listings} />
                <KpiCard label="New Orders"   value={d.activity_24h.new_orders} />
                <KpiCard label="Completions"  value={d.activity_24h.completions} color="text-green-300" />
              </div>
            </section>
            <section className="space-y-3">
              <SectionLabel>14-Day Activity</SectionLabel>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
                <div className="grid sm:grid-cols-3 gap-8">
                  {([['Orders','orders','#3b82f6'],['Completions','completions','#22c55e'],['Listings','listings','#f59e0b']] as [string,keyof DayRow,string][]).map(([label,key,color]) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400 font-medium">{label}</span>
                        <span className="text-xs font-mono text-slate-500">{d.daily.reduce((s,r)=>s+(r[key] as number),0)} total</span>
                      </div>
                      <Sparkline data={d.daily.map(r => r[key] as number)} color={color} />
                      <div className="flex justify-between text-[9px] text-slate-700">
                        <span>{fmtDate(d.daily[0]?.date)}</span>
                        <span>{fmtDate(d.daily[d.daily.length-1]?.date)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <section className="space-y-3">
              <SectionLabel>Order Funnel</SectionLabel>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 space-y-3">
                <FunnelBar label="Locked (claimed)"  val={d.orders.locked}          max={orderTotal} color="bg-amber-500" />
                <FunnelBar label="Buyer submitted"   val={d.orders.buyer_submitted} max={orderTotal} color="bg-blue-500" />
                <FunnelBar label="Seller accepted"   val={d.orders.seller_accepted} max={orderTotal} color="bg-purple-500" />
                <FunnelBar label="QR uploaded"       val={d.orders.qr_uploaded}     max={orderTotal} color="bg-emerald-500" />
                <FunnelBar label="✅ Completed"       val={d.orders.completed}       max={orderTotal} color="bg-green-400" />
                <FunnelBar label="❌ Cancelled"       val={d.orders.cancelled}       max={orderTotal} color="bg-rose-500" />
                <div className="pt-2 border-t border-slate-800 flex justify-between text-xs text-slate-600">
                  <span>Total: {d.orders.total} orders</span>
                  <span>{d.revenue.conversion_rate}% completion rate</span>
                </div>
              </div>
            </section>
            <section className="space-y-3">
              <SectionLabel>Listing Status Breakdown</SectionLabel>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[
                  ['Open',        d.listings.open,        'text-emerald-400 border-emerald-900/40 bg-emerald-950/20'],
                  ['Locked',      d.listings.locked,      'text-amber-400   border-amber-900/40   bg-amber-950/20'],
                  ['In Progress', d.listings.in_progress, 'text-blue-400    border-blue-900/40    bg-blue-950/20'],
                  ['Completed',   d.listings.completed,   'text-green-400   border-green-900/40   bg-green-950/20'],
                  ['Cancelled',   d.listings.cancelled,   'text-rose-400    border-rose-900/40    bg-rose-950/20'],
                  ['Expired',     d.listings.expired,     'text-slate-500   border-slate-700      bg-slate-900/20'],
                ].map(([label, val, c]) => (
                  <div key={label as string} className={`rounded-xl border p-3 text-center space-y-1 ${c}`}>
                    <p className="text-xl font-black leading-none">{val}</p>
                    <p className="text-[10px] opacity-70">{label}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* ORDERS */}
        {tab === 'orders' && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>Recent Orders ({d.recent_orders.length})</SectionLabel>
              {d.recent_orders.filter(o => o.is_stale || o.lock_expired).length > 0 && (
                <span className="text-xs text-amber-400 font-medium">
                  ⚠️ {d.recent_orders.filter(o => o.is_stale || o.lock_expired).length} need attention
                </span>
              )}
            </div>
            <div className="rounded-2xl border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80">
                      {['Order','Buyer','Seller','Amount','Status','When','Action'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {d.recent_orders.map((o, i) => (
                      <tr key={o.id} className={`hover:bg-slate-800/30 transition ${o.is_stale ? 'bg-amber-950/10' : i%2===0 ? '' : 'bg-slate-900/20'}`}>
                        <td className="px-4 py-3">
                          <p className="font-mono text-[11px] text-slate-500">#{o.id.slice(0,8).toUpperCase()}</p>
                          {!o.has_order_items && ['BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED'].includes(o.status) && (
                            <span className="text-[9px] text-red-400 border border-red-800/60 rounded px-1">no items</span>
                          )}
                          {o.is_stale && <span className="text-[9px] text-amber-400 border border-amber-800/60 rounded px-1 ml-1">stale 2h+</span>}
                          {o.lock_expired && <span className="text-[9px] text-slate-400 border border-slate-700 rounded px-1 ml-1">lock expired</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-300 text-xs">@{o.buyer_username}</td>
                        <td className="px-4 py-3 text-slate-300 text-xs">@{o.seller_username}</td>
                        <td className="px-4 py-3 font-semibold">{fmt$(o.amount_cents)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${SC[o.status] ?? SC.CANCELLED}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${SD[o.status] ?? 'bg-slate-500'}`} />
                            {o.status.replace(/_/g,' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{ago(o.created_at)}</td>
                        <td className="px-4 py-3">
                          {!['COMPLETED','CANCELLED'].includes(o.status) && (
                            <button onClick={() => setForceCancelId(o.id)}
                              className="text-[10px] px-2 py-1 rounded-lg border border-red-900/60 text-red-400 hover:bg-red-950/30 transition">
                              Force cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {d.recent_orders.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-600 text-sm">No orders yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* COOLDOWNS */}
        {tab === 'cooldowns' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <SectionLabel>Sellers In Cooldown</SectionLabel>
              <span className="text-xs text-slate-500">90-min post-completion window</span>
            </div>
            {d.cooldown_sellers.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 p-12 text-center space-y-2">
                <p className="text-3xl">✅</p>
                <p className="text-slate-400 font-semibold text-sm">No sellers currently in cooldown</p>
                <p className="text-slate-600 text-xs">Sellers enter a 90-min cooldown after each completed sale to ensure fair buyer access.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {d.cooldown_sellers.map((s, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-orange-900/40 bg-orange-950/10 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-full bg-orange-900/40 flex items-center justify-center text-sm">⏳</span>
                      <div>
                        <p className="font-semibold text-sm text-white">@{s.username}</p>
                        <p className="text-[10px] text-slate-500">Completed sale {ago(s.completed_at)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500 mb-0.5">Ends in</p>
                      <CooldownTimer endsAt={s.cooldown_ends} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4 space-y-1">
              <p className="text-xs font-semibold text-slate-400">How the cooldown works</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                After a listing completes, the seller enters a 90-minute cooldown before they can post again. This prevents monopolization.
                The timer starts when <code className="bg-slate-800 px-1 rounded">listings.completed_at</code> is set.
              </p>
            </div>
          </section>
        )}

        {/* AUDIT LOG */}
        {tab === 'log' && (
          <section className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <SectionLabel>Audit Log</SectionLabel>
              <input type="text" placeholder="Filter by action or user…" value={logFilter} onChange={e => setLogFilter(e.target.value)}
                className="flex-1 min-w-[180px] max-w-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-slate-500" />
              <span className="text-xs text-slate-600">{filteredLog.length} entries</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['','listing','order.claim','order.complete','order.cancel','admin'].map(f => (
                <button key={f} onClick={() => setLogFilter(f)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition ${logFilter === f ? 'bg-blue-900/50 border-blue-700 text-blue-300' : 'border-slate-700 text-slate-500 hover:border-slate-500'}`}>
                  {f || 'All'}
                </button>
              ))}
            </div>
            {filteredLog.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 p-10 text-center space-y-2">
                <p className="text-2xl">📋</p>
                <p className="text-slate-500 text-sm">{logFilter ? 'No entries match filter.' : 'No audit entries yet.'}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-800 overflow-hidden divide-y divide-slate-800/50">
                {filteredLog.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-800/20 transition group">
                    <span className="text-[10px] font-mono text-slate-700 mt-0.5 shrink-0 w-16 text-right group-hover:text-slate-500 transition">{ago(entry.created_at)}</span>
                    <div className="flex-1 min-w-0 flex items-baseline gap-2 flex-wrap">
                      <span className={`font-mono text-xs font-bold ${AC[entry.action] ?? 'text-slate-400'}`}>{entry.action}</span>
                      {entry.entity_id && <span className="font-mono text-[10px] text-slate-700">#{entry.entity_id.slice(0,8)}</span>}
                      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                        <span className="text-[10px] text-slate-700 truncate max-w-xs">{JSON.stringify(entry.metadata)}</span>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-600">@{entry.username}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* USERS */}
        {tab === 'users' && (
          <>
            <section className="space-y-3">
              <SectionLabel>User Metrics</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="Total Users"    value={d.users.total}        color="text-blue-300" />
                <KpiCard label="New Today"      value={d.users.new_24h}      color="text-emerald-300" />
                <KpiCard label="Unique Sellers" value={d.top_sellers.length} color="text-purple-300" />
                <KpiCard label="Unique Buyers"  value={d.top_buyers.length}  color="text-amber-300" />
              </div>
            </section>
            <div className="grid sm:grid-cols-2 gap-5">
              {[
                { title: 'Top Sellers — Revenue', data: d.top_sellers, valKey: 'revenue' as const, valColor: 'text-emerald-400' },
                { title: 'Top Buyers — Spend',    data: d.top_buyers,  valKey: 'spent'   as const, valColor: 'text-blue-400'    },
              ].map(({ title, data: rows, valKey, valColor }) => (
                <section key={title} className="space-y-3">
                  <SectionLabel>{title}</SectionLabel>
                  <div className="rounded-2xl border border-slate-800 overflow-hidden">
                    {rows.length === 0 ? (
                      <p className="p-8 text-center text-slate-600 text-sm">No completed orders yet</p>
                    ) : (
                      <div className="divide-y divide-slate-800/50">
                        {rows.map((r, i) => (
                          <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-slate-800/20 transition">
                            <div className="flex items-center gap-3">
                              <span className={`w-5 text-[10px] font-mono text-right shrink-0 ${i === 0 ? 'text-yellow-400' : 'text-slate-700'}`}>{i+1}</span>
                              <span className="text-sm font-medium">@{r.username}</span>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold ${valColor}`}>{fmt$((r as any)[valKey] ?? 0)}</p>
                              <p className="text-slate-600 text-[10px]">{r.completed} orders</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
