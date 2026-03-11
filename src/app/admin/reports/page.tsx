"use client";
import { useCallback, useEffect, useState } from 'react';
import { authedFetch } from '@/lib/fetcher';

const REASON_LABELS: Record<string, string> = {
  no_show:                 'No-show',
  harassment:              'Harassment / rude behavior',
  spam_fake_listing:       'Spam / fake listing',
  scam_suspicious:         'Scam / suspicious activity',
  inappropriate_content:   'Inappropriate content',
  repeated_cancellations:  'Repeated cancellations',
  other:                   'Other',
};

const STATUS_COLORS: Record<string, string> = {
  open:       'bg-amber-900/40 border-amber-700 text-amber-300',
  reviewed:   'bg-blue-900/40 border-blue-700 text-blue-300',
  resolved:   'bg-emerald-900/40 border-emerald-700 text-emerald-300',
  dismissed:  'bg-slate-800 border-slate-600 text-slate-400',
};

type Report = {
  id: string; created_at: string; updated_at: string;
  reporter_id: string; reporter_username: string;
  reported_user_id: string; reported_user_username: string;
  order_id: string | null; listing_id: string | null;
  reason_code: string; message: string;
  status: string; admin_notes: string | null;
  reviewed_by: string | null; reviewed_by_username: string | null; reviewed_at: string | null;
};

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ReportCard({ report, onUpdate, onBan }: {
  report: Report;
  onUpdate: (id: string, status: string, notes: string) => Promise<void>;
  onBan: (userId: string, username: string, permanent: boolean, days?: number) => Promise<void>;
}) {
  const [expanded,    setExpanded]    = useState(false);
  const [status,      setStatus]      = useState(report.status);
  const [notes,       setNotes]       = useState(report.admin_notes ?? '');
  const [saving,      setSaving]      = useState(false);
  const [banOpen,     setBanOpen]     = useState(false);
  const [banDays,     setBanDays]     = useState('');
  const [banBusy,     setBanBusy]     = useState(false);
  const [saveOk,      setSaveOk]      = useState(false);

  const save = async () => {
    setSaving(true); setSaveOk(false);
    await onUpdate(report.id, status, notes);
    setSaveOk(true);
    setSaving(false);
    setTimeout(() => setSaveOk(false), 2000);
  };

  const ban = async (permanent: boolean) => {
    setBanBusy(true);
    const days = permanent ? undefined : parseInt(banDays, 10);
    await onBan(report.reported_user_id, report.reported_user_username, permanent, days);
    setBanOpen(false); setBanBusy(false);
  };

  return (
    <article className="rounded-2xl border border-slate-700 bg-slate-900/40 overflow-hidden">
      {/* Summary row */}
      <button className="w-full text-left p-4 flex items-start gap-3" onClick={() => setExpanded(e => !e)}>
        <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_COLORS[report.status] ?? STATUS_COLORS.open}`}>
          {report.status}
        </span>
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-white">
            @{report.reporter_username} → @{report.reported_user_username}
          </p>
          <p className="text-xs text-slate-400">
            {REASON_LABELS[report.reason_code] ?? report.reason_code} · {ago(report.created_at)}
          </p>
        </div>
        <span className="text-slate-500 text-sm">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-700 p-4 space-y-4 text-sm">
          {/* Details */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><p className="text-slate-500">Reporter</p><p className="text-white">@{report.reporter_username}</p></div>
            <div><p className="text-slate-500">Reported user</p><p className="text-white">@{report.reported_user_username}</p></div>
            <div><p className="text-slate-500">Reason</p><p className="text-white">{REASON_LABELS[report.reason_code] ?? report.reason_code}</p></div>
            <div><p className="text-slate-500">Submitted</p><p className="text-white">{new Date(report.created_at).toLocaleString()}</p></div>
            {report.order_id && (
              <div className="col-span-2">
                <p className="text-slate-500">Order</p>
                <a href={`/orders/${report.order_id}`} className="text-blue-400 hover:underline font-mono text-xs">
                  #{report.order_id.slice(0, 8).toUpperCase()}
                </a>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-slate-800 border border-slate-700 p-3 space-y-1">
            <p className="text-slate-500 text-xs uppercase tracking-widest">User message</p>
            <p className="text-slate-200 whitespace-pre-wrap">{report.message}</p>
          </div>

          {report.reviewed_by_username && (
            <p className="text-xs text-slate-500">
              Reviewed by @{report.reviewed_by_username} · {report.reviewed_at ? ago(report.reviewed_at) : ''}
            </p>
          )}

          {/* Admin controls */}
          <div className="space-y-2 pt-1 border-t border-slate-700">
            <p className="text-xs text-slate-500 uppercase tracking-widest">Admin actions</p>

            <div className="flex gap-2">
              {(['open','reviewed','resolved','dismissed'] as const).map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition
                    ${status === s ? STATUS_COLORS[s] : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                  {s}
                </button>
              ))}
            </div>

            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Private admin notes (not shown to users)…"
              rows={2}
              className="w-full rounded-xl bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 resize-none focus:outline-none focus:border-blue-600"
            />

            <div className="flex gap-2">
              <button disabled={saving} onClick={save}
                className="flex-1 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 disabled:opacity-60 text-white text-sm font-semibold transition">
                {saving ? '…' : saveOk ? '✓ Saved' : 'Save changes'}
              </button>
              <button onClick={() => setBanOpen(b => !b)}
                className="px-4 py-2 rounded-xl border border-rose-700 text-rose-400 hover:bg-rose-950/30 text-sm transition">
                🚫 Ban user
              </button>
            </div>

            {banOpen && (
              <div className="rounded-xl border border-rose-800 bg-rose-950/20 p-3 space-y-2">
                <p className="text-rose-300 text-xs font-semibold">
                  Banning @{report.reported_user_username} — choose duration:
                </p>
                <div className="flex items-center gap-2">
                  <input type="number" min="1" max="365" value={banDays} onChange={e => setBanDays(e.target.value)}
                    placeholder="Days (leave blank for permanent)"
                    className="flex-1 rounded-lg bg-slate-800 border border-slate-600 text-sm text-white px-3 py-1.5 focus:outline-none focus:border-rose-600" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setBanOpen(false)}
                    className="flex-1 py-1.5 rounded-lg border border-slate-600 text-slate-400 text-xs transition hover:text-white">
                    Cancel
                  </button>
                  <button disabled={banBusy || (banDays !== '' && isNaN(parseInt(banDays, 10)))}
                    onClick={() => ban(!banDays)}
                    className="flex-1 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-60 text-white text-xs font-semibold transition">
                    {banBusy ? '…' : banDays ? `Suspend ${banDays}d` : 'Permanent ban'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export default function AdminReportsPage() {
  const [reports,    setReports]    = useState<Report[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState('');
  const [toast,      setToast]      = useState('');
  const [statusFilt, setStatusFilt] = useState('');
  const [reasonFilt, setReasonFilt] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const params = new URLSearchParams();
      if (statusFilt) params.set('status', statusFilt);
      if (reasonFilt) params.set('reason', reasonFilt);
      const res = await authedFetch(`/api/admin/reports?${params}`);
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to load');
      setReports(d.reports ?? []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [statusFilt, reasonFilt]);

  useEffect(() => { load(); }, [load]);

  const handleUpdate = async (id: string, status: string, admin_notes: string) => {
    try {
      const res = await authedFetch(`/api/admin/reports/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ status, admin_notes }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setReports(prev => prev.map(r => r.id === id ? { ...r, status, admin_notes: admin_notes || null } : r));
      showToast('Report updated');
    } catch (e: any) { showToast(`Error: ${e.message}`); }
  };

  const handleBan = async (userId: string, username: string, permanent: boolean, days?: number) => {
    try {
      const res = await authedFetch(`/api/admin/users/${userId}/ban`, {
        method: 'POST',
        body:   JSON.stringify({
          reason: `Banned from report review`,
          ...(permanent ? {} : { days }),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      showToast(permanent ? `@${username} permanently banned` : `@${username} suspended for ${days} days`);
    } catch (e: any) { showToast(`Ban failed: ${e.message}`); }
  };

  const openCount = reports.filter(r => r.status === 'open').length;

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-3 inset-x-4 z-50 rounded-xl bg-slate-800 border border-slate-600 text-white px-4 py-3 text-sm text-center shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-black">🚨 Reports</h1>
          <p className="text-slate-400 text-sm">
            Private moderation queue · {openCount} open
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href="/admin/audit" className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white text-sm transition">
            ← Audit
          </a>
          <button onClick={load} className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white text-sm transition">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select value={statusFilt} onChange={e => setStatusFilt(e.target.value)}
          className="rounded-lg bg-slate-800 border border-slate-700 text-sm text-white px-3 py-1.5 focus:outline-none">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="reviewed">Reviewed</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select value={reasonFilt} onChange={e => setReasonFilt(e.target.value)}
          className="rounded-lg bg-slate-800 border border-slate-700 text-sm text-white px-3 py-1.5 focus:outline-none">
          <option value="">All reasons</option>
          {Object.entries(REASON_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="rounded-2xl border border-slate-700 h-16 animate-pulse bg-slate-800/40" />)}
        </div>
      )}

      {!loading && err && (
        <div className="rounded-2xl border border-rose-800 bg-rose-950/30 p-4">
          <p className="text-rose-300 text-sm">{err}</p>
          <button onClick={load} className="mt-2 text-sm px-3 py-1 rounded bg-slate-700 hover:bg-slate-600">Retry</button>
        </div>
      )}

      {!loading && !err && reports.length === 0 && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-10 text-center">
          <p className="text-slate-400">No reports match these filters.</p>
        </div>
      )}

      {!loading && !err && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map(r => (
            <ReportCard key={r.id} report={r} onUpdate={handleUpdate} onBan={handleBan} />
          ))}
        </div>
      )}
    </div>
  );
}
