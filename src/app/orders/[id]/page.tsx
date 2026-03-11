"use client";
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authedFetch, jsonOrThrow } from '@/lib/fetcher';
import { supabase } from '@/lib/supabaseClient';
import StatusTimeline from '@/components/StatusTimeline';

type Order  = { id:string; status:string; amount_cents:number; created_at:string; seller_id:string; buyer_id:string; lock_expires_at:string; qr_image_url:string|null; order_items:any };
type Review = { id:string; rating:number; body:string|null; created_at:string };

const CANCEL_REASONS: { code: string; label: string }[] = [
  { code: 'changed_mind',      label: 'Changed my mind' },
  { code: 'wait_too_long',     label: 'Wait is too long' },
  { code: 'wrong_order',       label: 'Wrong items / misunderstanding' },
  { code: 'seller_unresponsive', label: 'Seller not responding' },
  { code: 'buyer_unresponsive',  label: 'Buyer not responding' },
  { code: 'other',             label: 'Other' },
];

const BUYER_INFO: Record<string, { emoji:string; title:string; detail:string }> = {
  LOCKED:          { emoji:'🔒', title:'Meal locked',        detail:'Choose your food below before the timer runs out.' },
  BUYER_SUBMITTED: { emoji:'⏳', title:'Waiting on seller',  detail:'Your meal choices were sent. Waiting for seller to accept.' },
  SELLER_ACCEPTED: { emoji:'✅', title:'Seller accepted',    detail:'They\'re uploading the Ortega QR. You\'ll be notified.' },
  QR_UPLOADED:     { emoji:'📲', title:'QR ready!',          detail:'Tap below to view your QR and head to Ortega.' },
  COMPLETED:       { emoji:'🎉', title:'Complete!',          detail:'You picked up your meal. Thanks for using GauchoGrub!' },
  CANCELLED:       { emoji:'❌', title:'Cancelled',          detail:'This order was cancelled.' },
};
const SELLER_INFO: Record<string, { emoji:string; title:string; detail:string }> = {
  LOCKED:          { emoji:'🛒', title:'New order!',         detail:'Buyer locked your listing. Wait for them to submit meal choices.' },
  BUYER_SUBMITTED: { emoji:'🍽️', title:'Review meal choices', detail:'Buyer submitted their order. Accept below.' },
  SELLER_ACCEPTED: { emoji:'📲', title:'Upload QR now',      detail:'Upload your Ortega dining QR code so the buyer can pick up.' },
  QR_UPLOADED:     { emoji:'⏳', title:'Waiting on buyer',   detail:'QR delivered. Waiting for buyer to confirm pickup.' },
  COMPLETED:       { emoji:'🎉', title:'Complete!',          detail:'Buyer confirmed pickup. Transaction done!' },
  CANCELLED:       { emoji:'❌', title:'Cancelled',          detail:'This order was cancelled.' },
};

function Cd({ until }: { until: string }) {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
      setT(`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`);
    };
    tick(); const i = setInterval(tick, 1000); return () => clearInterval(i);
  }, [until]);
  return <span className="font-mono text-amber-300">{t}</span>;
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)}
          className={`text-3xl transition-transform active:scale-90 select-none
            ${n <= value ? 'text-yellow-400' : 'text-slate-600 hover:text-yellow-500'}`}>
          ★
        </button>
      ))}
    </div>
  );
}

export default function OrderPage() {
  const { id }       = useParams<{ id:string }>();
  const router       = useRouter();
  const [order, setOrder]   = useState<Order|null>(null);
  const [myId,  setMyId]    = useState('');
  const [loading, setLoad]  = useState(true);
  const [err,   setErr]     = useState('');
  const [busy,  setBusy]    = useState('');
  const [qrUrl, setQrUrl]   = useState('');
  const [qrLoad,setQrLoad]  = useState(false);
  const [upLoad,setUpLoad]  = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // cancel sheet state
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelCode, setCancelCode] = useState('');
  const [cancelText, setCancelText] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  // report sheet state
  const [reportOpen,   setReportOpen]   = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportMsg,    setReportMsg]    = useState('');
  const [reportBusy,   setReportBusy]   = useState(false);
  const [reportErr,    setReportErr]    = useState('');
  const [reportDone,   setReportDone]   = useState(false);

  // review state — undefined=not fetched, null=no review yet, object=review exists
  const [review,   setReview]   = useState<Review|null|undefined>(undefined);
  const [rvRating, setRvRating] = useState(5);
  const [rvBody,   setRvBody]   = useState('');
  const [rvBusy,   setRvBusy]   = useState(false);
  const [rvErr,    setRvErr]    = useState('');

  const reload = async () => {
    try {
      const d = await jsonOrThrow<{ order: Order }>(await authedFetch(`/api/orders/${id}`));
      setOrder(d.order);
    } catch (e: any) { setErr(e.message); }
    finally { setLoad(false); }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data:{session} }) => { if (session?.user) setMyId(session.user.id); });
    reload();
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [id]);

  // Fetch the review once the order is COMPLETED and we know who the user is.
  // Both buyer and seller can see the review via GET /api/orders/[id]/review.
  useEffect(() => {
    if (!order || !myId) return;
    if (order.status !== 'COMPLETED') return;
    if (order.buyer_id !== myId && order.seller_id !== myId) return;
    authedFetch(`/api/orders/${id}/review`)
      .then(r => r.json())
      .then(d => setReview(d.review ?? null))
      .catch(() => setReview(null));
  }, [order?.status, myId, id]);

  const act = async (action: string, confirm_msg?: string) => {
    if (confirm_msg && !window.confirm(confirm_msg)) return;
    try { setBusy(action); setErr('');
      await jsonOrThrow(await authedFetch(`/api/orders/${id}/${action}`, { method:'POST' }));
      await reload();
    } catch (e:any) { setErr(e.message); } finally { setBusy(''); }
  };

  const uploadQr = async (file: File) => {
    try {
      setUpLoad(true); setErr('');
      const form = new FormData(); form.append('file', file);
      const sess = (await supabase.auth.getSession()).data.session;
      const res  = await fetch(`/api/orders/${id}/qr`, { method:'POST', body:form,
        headers: { Authorization: `Bearer ${sess?.access_token}` } });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? 'Upload failed'); return; }
      await reload();
    } catch (e:any) { setErr(e.message); } finally { setUpLoad(false); }
  };

  const viewQr = async () => {
    try { setQrLoad(true); setErr('');
      const d = await jsonOrThrow<{ url:string }>(await authedFetch(`/api/orders/${id}/qr`));
      setQrUrl(d.url);
    } catch (e:any) { setErr(e.message); } finally { setQrLoad(false); }
  };

  const submitReview = async () => {
    try {
      setRvBusy(true); setRvErr('');
      await jsonOrThrow(await authedFetch(`/api/orders/${id}/review`, {
        method: 'POST',
        body:   JSON.stringify({ rating: rvRating, body: rvBody.trim() || undefined }),
      }));
      // Optimistically show the submitted review without a round-trip
      setReview({ id: 'local', rating: rvRating, body: rvBody.trim() || null, created_at: new Date().toISOString() });
    } catch (e:any) { setRvErr(e.message); } finally { setRvBusy(false); }
  };

  const submitCancel = async () => {
    try {
      setCancelBusy(true); setErr('');
      await jsonOrThrow(await authedFetch(`/api/orders/${id}/cancel`, {
        method: 'POST',
        body:   JSON.stringify({
          cancel_reason_code: cancelCode || undefined,
          cancel_reason_text: cancelText.trim() || undefined,
        }),
      }));
      setCancelOpen(false);
      // Buyers go back to the board; sellers stay to see their listing status
      if (order?.buyer_id === myId) {
        router.push('/board');
      } else {
        await reload();
      }
    } catch (e: any) { setErr(e.message); } finally { setCancelBusy(false); }
  };

  const submitReport = async () => {
    setReportErr('');
    if (!reportReason) { setReportErr('Please select a reason'); return; }
    if (reportMsg.trim().length < 10) { setReportErr('Please write at least 10 characters describing the issue'); return; }
    try {
      setReportBusy(true);
      const other = order?.buyer_id === myId ? order?.seller_id : order?.buyer_id;
      await jsonOrThrow(await authedFetch('/api/reports', {
        method: 'POST',
        body:   JSON.stringify({
          reported_user_id: other,
          order_id:         id,
          reason_code:      reportReason,
          message:          reportMsg.trim(),
        }),
      }));
      setReportDone(true);
      setReportOpen(false);
    } catch (e: any) { setReportErr(e.message); } finally { setReportBusy(false); }
  };

  if (loading)  return <div className="p-6 flex justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!order)   return <div className="p-6 text-rose-400">{err || 'Order not found'}</div>;

  const isSeller = order.seller_id === myId;
  const isBuyer  = order.buyer_id  === myId;
  const info     = isSeller ? SELLER_INFO[order.status] : BUYER_INFO[order.status];
  const lockSecs = order.lock_expires_at ? (new Date(order.lock_expires_at).getTime() - Date.now())/1000 : 0;

  return (
    <div className="space-y-4">
      <button onClick={() => router.back()} className="text-slate-400 hover:text-white text-sm transition">← Back</button>

      {/* Timeline */}
      {!['COMPLETED','CANCELLED'].includes(order.status) && (
        <div className="overflow-x-auto">
          <StatusTimeline status={order.status} />
        </div>
      )}

      {/* Status banner */}
      {info && (
        <section className={`rounded-2xl border p-4 space-y-1 ${
          order.status==='COMPLETED' ? 'border-emerald-700 bg-emerald-950/20' :
          order.status==='CANCELLED' ? 'border-slate-600 bg-slate-800/20' :
          isSeller && order.status==='BUYER_SUBMITTED' ? 'border-amber-600 bg-amber-950/20' :
          isSeller && order.status==='SELLER_ACCEPTED' ? 'border-purple-600 bg-purple-950/20' :
          'border-blue-700 bg-blue-950/20'}`}>
          <p className="text-2xl">{info.emoji}</p>
          <p className="font-bold text-white">{info.title}</p>
          <p className="text-slate-400 text-sm">{info.detail}</p>
          {order.status==='LOCKED' && lockSecs > 0 && (
            <p className="text-sm text-slate-400">Lock expires: <Cd until={order.lock_expires_at} /></p>
          )}
        </section>
      )}

      {/* Summary */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm space-y-2">
        <div className="flex justify-between"><span className="text-slate-400">Amount</span><span className="font-bold">${(order.amount_cents/100).toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Your role</span><span className={isSeller ? 'text-purple-400 font-medium' : 'text-blue-400 font-medium'}>{isSeller ? '🛒 Seller' : '👤 Buyer'}</span></div>
        <div className="flex justify-between"><span className="text-slate-400">Order ID</span><span className="font-mono text-slate-500 text-xs">#{order.id.slice(0,8).toUpperCase()}</span></div>
      </section>

      {/* Meal details */}
      {order.order_items && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-1.5">
          <p className="font-semibold text-slate-300 text-sm mb-2">📋 Meal details</p>
          <p className="text-white text-sm font-medium">🍽️ {order.order_items.entree}</p>
          {order.order_items.side      && <p className="text-slate-300 text-sm">🥗 {order.order_items.side}</p>}
          {order.order_items.dessert   && <p className="text-slate-300 text-sm">🍪 {order.order_items.dessert}</p>}
          {order.order_items.fruits?.length > 0 && <p className="text-slate-300 text-sm">🍎 {order.order_items.fruits.join(', ')}</p>}
          {order.order_items.beverage  && <p className="text-slate-300 text-sm">💧 {order.order_items.beverage}</p>}
          {order.order_items.condiments?.length > 0 && <p className="text-slate-300 text-sm">🧴 {order.order_items.condiments.join(', ')}</p>}
          {order.order_items.notes     && <p className="text-slate-400 text-xs italic mt-1">📝 {order.order_items.notes}</p>}
        </section>
      )}

      {/* Buyer: choose meal */}
      {isBuyer && order.status==='LOCKED' && !order.order_items && (
        <button onClick={() => router.push(`/orders/${id}/customize`)}
          className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 font-bold text-base transition active:scale-95">
          🍽️ Choose your meal →
        </button>
      )}

      {/* Seller: accept */}
      {isSeller && order.status==='BUYER_SUBMITTED' && (
        <section className="rounded-2xl border-2 border-amber-600 bg-amber-950/20 p-5 space-y-3">
          <h2 className="font-bold text-amber-300">Step 1 — Accept this order</h2>
          <p className="text-slate-400 text-sm">Review the meal details above, then accept to proceed to QR upload.</p>
          <button disabled={busy==='accept'} onClick={() => act('accept')}
            className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-60 font-bold transition">
            {busy==='accept' ? '…' : '✅ Accept order'}
          </button>
        </section>
      )}

      {/* Seller: upload QR */}
      {isSeller && order.status==='SELLER_ACCEPTED' && (
        <section className="rounded-2xl border-2 border-purple-500 bg-purple-950/20 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📲</span>
            <h2 className="font-bold text-purple-300">Step 2 — Upload your Ortega QR</h2>
          </div>
          <p className="text-slate-300 text-sm">Take a screenshot of your Ortega dining QR code and upload it. <strong>Only the buyer can see it.</strong></p>
          <div className="bg-slate-800/60 border border-slate-600 rounded-xl p-3 text-xs text-slate-400 space-y-0.5">
            <p>📍 Find your QR in the Ortega Dining app → QR Code tab</p>
            <p>📸 Take a clear screenshot so it scans correctly</p>
            <p>🔒 QR expires in 5 min once viewed — buyer will screenshot it</p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f=e.target.files?.[0]; if(f) uploadQr(f); e.target.value=''; }} />
          <button disabled={upLoad} onClick={() => fileRef.current?.click()}
            className="w-full py-4 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 font-bold transition active:scale-95">
            {upLoad ? '⏳ Uploading…' : order.qr_image_url ? '✓ Re-upload QR' : '📤 Upload QR screenshot'}
          </button>
          {order.qr_image_url && <p className="text-emerald-400 text-sm text-center">✓ QR uploaded — buyer notified</p>}
        </section>
      )}

      {/* Buyer: view QR */}
      {isBuyer && order.qr_image_url && ['QR_UPLOADED','COMPLETED'].includes(order.status) && (
        <section className="rounded-2xl border-2 border-emerald-600 bg-emerald-950/20 p-5 space-y-3">
          <div className="flex items-center gap-2"><span className="text-2xl">🎟️</span><h2 className="font-bold text-emerald-300">Your Ortega QR</h2></div>
          <p className="text-slate-400 text-sm">Show this at the Ortega register. Screenshot it — it expires in 5 minutes once shown.</p>
          {!qrUrl
            ? <button disabled={qrLoad} onClick={viewQr}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-bold transition">
                {qrLoad ? '…' : '👁️ Show QR code'}
              </button>
            : <div className="space-y-2">
                <img src={qrUrl} alt="Ortega QR" className="w-full rounded-xl border border-slate-600 shadow-lg" />
                <button onClick={() => setQrUrl('')} className="w-full py-2 rounded-xl border border-slate-600 text-slate-400 text-sm hover:text-white transition">Hide</button>
              </div>
          }
        </section>
      )}

      {/* Buyer: waiting for QR */}
      {isBuyer && !order.qr_image_url && order.status==='SELLER_ACCEPTED' && (
        <div className="rounded-2xl border border-slate-600 bg-slate-800/20 p-4 text-center space-y-1">
          <p className="text-slate-400 text-sm animate-pulse">⏳ Waiting for seller to upload QR…</p>
          <p className="text-slate-600 text-xs">Page refreshes every 15s</p>
        </div>
      )}

      {err && <p className="text-rose-400 text-sm text-center">{err}</p>}

      {/* Actions */}
      <div className="space-y-2 pt-1">
        {isBuyer && order.status==='QR_UPLOADED' && (
          <button disabled={busy==='complete'} onClick={() => act('complete','Confirm you successfully picked up your meal at Ortega?')}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-semibold transition">
            {busy==='complete' ? '…' : '✓ I picked up my meal — mark complete'}
          </button>
        )}
        {!['COMPLETED','CANCELLED'].includes(order.status) && !cancelOpen && (
          <button onClick={() => setCancelOpen(true)}
            className="w-full py-3 rounded-xl border border-rose-700 text-rose-400 hover:bg-rose-950/30 font-medium text-sm transition">
            Cancel order
          </button>
        )}
        {!['COMPLETED','CANCELLED'].includes(order.status) && cancelOpen && (
          <section className="rounded-2xl border border-rose-800 bg-rose-950/20 p-4 space-y-3">
            <p className="text-rose-300 font-semibold text-sm">Why are you cancelling? <span className="text-slate-500 font-normal">(optional)</span></p>
            <div className="grid grid-cols-1 gap-1.5">
              {CANCEL_REASONS.map(r => (
                <button key={r.code} type="button"
                  onClick={() => setCancelCode(c => c === r.code ? '' : r.code)}
                  className={`text-left px-3 py-2 rounded-xl border text-sm transition
                    ${cancelCode === r.code
                      ? 'border-rose-500 bg-rose-900/40 text-rose-200'
                      : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-rose-700'}`}>
                  {r.label}
                </button>
              ))}
            </div>
            {(cancelCode === 'other' || cancelCode === '') && (
              <textarea
                value={cancelText} onChange={e => setCancelText(e.target.value)}
                placeholder="Any additional details… (optional)"
                maxLength={500} rows={2}
                className="w-full rounded-xl bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 resize-none focus:outline-none focus:border-rose-600"
              />
            )}
            <div className="flex gap-2">
              <button onClick={() => { setCancelOpen(false); setCancelCode(''); setCancelText(''); }}
                className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-400 hover:text-white text-sm transition">
                Never mind
              </button>
              <button disabled={cancelBusy} onClick={submitCancel}
                className="flex-1 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 disabled:opacity-60 text-white font-semibold text-sm transition">
                {cancelBusy ? '…' : 'Confirm cancel'}
              </button>
            </div>
          </section>
        )}
      </div>

      {/* ── Reviews ────────────────────────────────────────────────── */}
      {order.status === 'COMPLETED' && (
        <>
          {/* Buyer: review form (only if no review submitted yet) */}
          {isBuyer && review === null && (
            <section className="rounded-2xl border border-yellow-700 bg-yellow-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⭐</span>
                <h2 className="font-bold text-yellow-300">Rate your seller</h2>
              </div>
              <p className="text-slate-400 text-sm">How did the transaction go? Your feedback helps the community.</p>
              <StarPicker value={rvRating} onChange={setRvRating} />
              <textarea
                value={rvBody} onChange={e => setRvBody(e.target.value)}
                placeholder="Optional note (max 500 chars)…"
                maxLength={500}
                rows={3}
                className="w-full rounded-xl bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 resize-none focus:outline-none focus:border-yellow-600"
              />
              {rvErr && <p className="text-rose-400 text-sm">{rvErr}</p>}
              <button disabled={rvBusy} onClick={submitReview}
                className="w-full py-3 rounded-xl bg-yellow-600 hover:bg-yellow-500 disabled:opacity-60 font-bold text-sm transition">
                {rvBusy ? '…' : '⭐ Submit review'}
              </button>
            </section>
          )}

          {/* Buyer: submitted review display */}
          {isBuyer && review != null && (
            <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-1">
              <p className="text-sm font-semibold text-slate-300">Your review</p>
              <p className="text-yellow-400 text-xl tracking-wide">
                {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
              </p>
              {review.body && <p className="text-slate-400 text-sm italic">"{review.body}"</p>}
            </section>
          )}

          {/* Seller: see the review they received */}
          {isSeller && review != null && (
            <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-1">
              <p className="text-sm font-semibold text-slate-300">Buyer review</p>
              <p className="text-yellow-400 text-xl tracking-wide">
                {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
              </p>
              {review.body && <p className="text-slate-400 text-sm italic">"{review.body}"</p>}
            </section>
          )}
        </>
      )}

      {/* ── Report ──────────────────────────────────────────────────── */}
      {(isBuyer || isSeller) && !reportDone && !reportOpen && (
        <button onClick={() => setReportOpen(true)}
          className="w-full py-2 rounded-xl border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 text-xs transition">
          🚩 Report a problem with this transaction
        </button>
      )}

      {reportDone && (
        <p className="text-center text-slate-500 text-xs py-2">✓ Report submitted — our team will review it privately.</p>
      )}

      {reportOpen && (
        <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-300">🚩 Report a problem</p>
            <button onClick={() => { setReportOpen(false); setReportErr(''); }}
              className="text-slate-500 hover:text-white text-xs">✕ Close</button>
          </div>
          <p className="text-slate-500 text-xs">Reports are private and reviewed only by our team. They do not affect public ratings.</p>

          <div className="space-y-1.5">
            {[
              { code: 'no_show',                label: 'No-show' },
              { code: 'harassment',             label: 'Harassment / rude behavior' },
              { code: 'spam_fake_listing',      label: 'Spam / fake listing' },
              { code: 'scam_suspicious',        label: 'Scam / suspicious activity' },
              { code: 'inappropriate_content',  label: 'Inappropriate content' },
              { code: 'repeated_cancellations', label: 'Repeated cancellations' },
              { code: 'other',                  label: 'Other' },
            ].map(r => (
              <button key={r.code} type="button"
                onClick={() => setReportReason(c => c === r.code ? '' : r.code)}
                className={`w-full text-left px-3 py-2 rounded-xl border text-sm transition
                  ${reportReason === r.code
                    ? 'border-slate-500 bg-slate-700 text-white'
                    : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600'}`}>
                {r.label}
              </button>
            ))}
          </div>

          <textarea
            value={reportMsg} onChange={e => setReportMsg(e.target.value)}
            placeholder="Describe what happened (required, min 10 characters)…"
            maxLength={1000} rows={3}
            className="w-full rounded-xl bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 resize-none focus:outline-none focus:border-slate-500"
          />

          {reportErr && <p className="text-rose-400 text-sm">{reportErr}</p>}

          <button disabled={reportBusy} onClick={submitReport}
            className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-60 text-white text-sm font-semibold transition">
            {reportBusy ? '…' : 'Submit report'}
          </button>
        </section>
      )}
    </div>
  );
}
