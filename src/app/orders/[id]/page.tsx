"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authedFetch, jsonOrThrow, getValidToken } from '@/lib/fetcher';
import { supabase } from '@/lib/supabaseClient';
import StatusTimeline from '@/components/StatusTimeline';
import { PAYMENT_CONFIRM_TIMEOUT_MS } from '@/lib/status';

// ── Types ──────────────────────────────────────────────────────────────────
type PaymentMethod = { method: string; handle: string; is_active: boolean };
type Order = {
  id: string; status: string; amount_cents: number;
  created_at: string; seller_id: string; buyer_id: string;
  lock_expires_at: string; qr_image_url: string | null; order_items: any;
  payment_screenshot_url: string | null;
  payment_sent_at: string | null; payment_confirmed_at: string | null;
  seller_username: string | null;
  seller_payment_methods: PaymentMethod[];
};
type Review  = { id: string; rating: number; body: string | null; created_at: string };
type Message = { id: string; sender_id: string; sender_username: string; body: string; created_at: string };

// ── Payment method display config ──────────────────────────────────────────
const PM_META: Record<string, { label: string; icon: string; prefix: string; placeholder: string }> = {
  venmo:     { label: 'Venmo',     icon: '💙', prefix: '@',  placeholder: '@username' },
  zelle:     { label: 'Zelle',     icon: '💛', prefix: '',   placeholder: 'email or phone' },
  apple_pay: { label: 'Apple Pay', icon: '🍎', prefix: '',   placeholder: 'phone number' },
  paypal:    { label: 'PayPal',    icon: '🅿️', prefix: '@',  placeholder: '@username or email' },
  cash_app:  { label: 'Cash App',  icon: '💚', prefix: '$',  placeholder: '$cashtag' },
};

// ── Cancel reasons ─────────────────────────────────────────────────────────
const CANCEL_REASONS = [
  { code: 'changed_mind',        label: 'Changed my mind' },
  { code: 'wait_too_long',       label: 'Taking too long' },
  { code: 'wrong_order',         label: 'Wrong items / misunderstanding' },
  { code: 'seller_unresponsive', label: 'Seller not responding' },
  { code: 'buyer_unresponsive',  label: 'Buyer not responding' },
  { code: 'payment_issue',       label: 'Payment issue' },
  { code: 'other',               label: 'Other' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function Cd({ until }: { until: string }) {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => {
      const s = Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
      setT(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    tick(); const i = setInterval(tick, 1000); return () => clearInterval(i);
  }, [until]);
  return <span className="font-mono text-amber-300">{t}</span>;
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)}
          className={`text-3xl transition-transform active:scale-90 select-none
            ${n <= value ? 'text-yellow-400' : 'text-slate-600 hover:text-yellow-500'}`}>★</button>
      ))}
    </div>
  );
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ══════════════════════════════════════════════════════════════════════════
export default function OrderPage() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const [order,   setOrder]   = useState<Order | null>(null);
  const [myId,    setMyId]    = useState('');
  const [loading, setLoad]    = useState(true);
  const [err,     setErr]     = useState('');
  const [busy,    setBusy]    = useState('');
  const [qrUrl,   setQrUrl]   = useState('');
  const [qrLoad,  setQrLoad]  = useState(false);
  const [upLoad,  setUpLoad]  = useState(false);
  const fileRef    = useRef<HTMLInputElement>(null);
  const ssFileRef  = useRef<HTMLInputElement>(null);

  // Payment sent sheet
  const [paySheet,   setPaySheet]   = useState(false);
  const [ssFile,     setSsFile]     = useState<File | null>(null);
  const [payBusy,    setPayBusy]    = useState(false);

  // Dispute sheet (seller)
  const [dispOpen,   setDispOpen]   = useState(false);
  const [dispNote,   setDispNote]   = useState('');
  const [dispBusy,   setDispBusy]   = useState(false);

  // Cancel sheet
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelCode, setCancelCode] = useState('');
  const [cancelText, setCancelText] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  // Report sheet
  const [reportOpen,   setReportOpen]   = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportMsg,    setReportMsg]    = useState('');
  const [reportBusy,   setReportBusy]   = useState(false);
  const [reportErr,    setReportErr]    = useState('');
  const [reportDone,   setReportDone]   = useState(false);

  // Review
  const [review,   setReview]   = useState<Review | null | undefined>(undefined);
  const [rvRating, setRvRating] = useState(5);
  const [rvBody,   setRvBody]   = useState('');
  const [rvBusy,   setRvBusy]   = useState(false);
  const [rvErr,    setRvErr]    = useState('');

  // Chat
  const [msgs,      setMsgs]      = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy,  setChatBusy]  = useState(false);
  const [chatOpen,  setChatOpen]  = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // ── Data fetching ────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    try {
      const d = await jsonOrThrow<{ order: Order }>(await authedFetch(`/api/orders/${id}`));
      setOrder(d.order);
    } catch (e: any) { setErr(e.message); }
    finally { setLoad(false); }
  }, [id]);

  const loadMessages = useCallback(async () => {
    try {
      const d = await jsonOrThrow<{ messages: Message[] }>(await authedFetch(`/api/orders/${id}/chat`));
      setMsgs(d.messages ?? []);
    } catch { /* non-fatal */ }
  }, [id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setMyId(session.user.id);
    });
    reload();
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [id, reload]);

  // Load chat on mount and poll every 5s when chat is open
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!chatOpen) return;
    const t = setInterval(loadMessages, 5_000);
    return () => clearInterval(t);
  }, [chatOpen, loadMessages]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatOpen) chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, chatOpen]);

  // Load review when COMPLETED
  useEffect(() => {
    if (!order || !myId) return;
    if (order.status !== 'COMPLETED') return;
    if (order.buyer_id !== myId && order.seller_id !== myId) return;
    authedFetch(`/api/orders/${id}/review`)
      .then(r => r.json())
      .then(d => setReview(d.review ?? null))
      .catch(() => setReview(null));
  }, [order?.status, myId, id]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const act = async (action: string, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    try {
      setBusy(action); setErr('');
      await jsonOrThrow(await authedFetch(`/api/orders/${id}/${action}`, { method: 'POST' }));
      await reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const submitPaymentSent = async () => {
    try {
      setPayBusy(true); setErr('');
      let res: Response;
      if (ssFile) {
        const form = new FormData();
        form.append('file', ssFile);
        const token = await getValidToken();
        res = await fetch(`/api/orders/${id}/payment-sent`, {
          method: 'POST', body: form,
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        res = await authedFetch(`/api/orders/${id}/payment-sent`, { method: 'POST' });
      }
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? 'Failed'); return; }
      setPaySheet(false); setSsFile(null);
      await reload();
    } catch (e: any) { setErr(e.message); } finally { setPayBusy(false); }
  };

  const submitDispute = async () => {
    try {
      setDispBusy(true); setErr('');
      await jsonOrThrow(await authedFetch(`/api/orders/${id}/dispute`, {
        method: 'POST',
        body:   JSON.stringify({ note: dispNote }),
      }));
      setDispOpen(false);
      await reload();
    } catch (e: any) { setErr(e.message); } finally { setDispBusy(false); }
  };

  const uploadQr = async (file: File) => {
    try {
      setUpLoad(true); setErr('');
      const form = new FormData(); form.append('file', file);
      const token = await getValidToken();
      const res = await fetch(`/api/orders/${id}/qr`, {
        method: 'POST', body: form,
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? 'Upload failed'); return; }
      await reload();
    } catch (e: any) { setErr(e.message); } finally { setUpLoad(false); }
  };

  const viewQr = async () => {
    try {
      setQrLoad(true); setErr('');
      const d = await jsonOrThrow<{ url: string }>(await authedFetch(`/api/orders/${id}/qr`));
      setQrUrl(d.url);
    } catch (e: any) { setErr(e.message); } finally { setQrLoad(false); }
  };

  const submitReview = async () => {
    try {
      setRvBusy(true); setRvErr('');
      await jsonOrThrow(await authedFetch(`/api/orders/${id}/review`, {
        method: 'POST',
        body:   JSON.stringify({ rating: rvRating, body: rvBody.trim() || undefined }),
      }));
      setReview({ id: 'local', rating: rvRating, body: rvBody.trim() || null, created_at: new Date().toISOString() });
    } catch (e: any) { setRvErr(e.message); } finally { setRvBusy(false); }
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
      if (order?.buyer_id === myId) router.push('/board');
      else await reload();
    } catch (e: any) { setErr(e.message); } finally { setCancelBusy(false); }
  };

  const submitReport = async () => {
    setReportErr('');
    if (!reportReason) { setReportErr('Please select a reason'); return; }
    if (reportMsg.trim().length < 10) { setReportErr('Please write at least 10 characters'); return; }
    try {
      setReportBusy(true);
      const other = order?.buyer_id === myId ? order?.seller_id : order?.buyer_id;
      await jsonOrThrow(await authedFetch('/api/reports', {
        method: 'POST',
        body:   JSON.stringify({
          reported_user_id: other,
          order_id: id,
          reason_code: reportReason,
          message: reportMsg.trim(),
        }),
      }));
      setReportDone(true); setReportOpen(false);
    } catch (e: any) { setReportErr(e.message); } finally { setReportBusy(false); }
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    try {
      setChatBusy(true);
      await jsonOrThrow(await authedFetch(`/api/orders/${id}/chat`, {
        method: 'POST', body: JSON.stringify({ body: text }),
      }));
      setChatInput('');
      await loadMessages();
    } catch (e: any) { setErr(e.message); } finally { setChatBusy(false); }
  };

  // ── Render guards ────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex justify-center p-10">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!order) return <div className="p-6 text-rose-400">{err || 'Order not found'}</div>;

  const isSeller  = order.seller_id === myId;
  const isBuyer   = order.buyer_id  === myId;
  const isActive  = !['COMPLETED', 'CANCELLED', 'DISPUTED'].includes(order.status);
  const lockSecs  = order.lock_expires_at ? (new Date(order.lock_expires_at).getTime() - Date.now()) / 1000 : 0;
  const paymentMethods = (order.seller_payment_methods ?? []).filter(p => p.is_active);
  const amountLabel = order.amount_cents === 0 ? 'Free' : `$${(order.amount_cents / 100).toFixed(2)}`;

  // Stale payment: if seller hasn't confirmed for 4h, buyer can flag
  const paymentStale = order.status === 'PAYMENT_SENT' && order.payment_sent_at
    && (Date.now() - new Date(order.payment_sent_at).getTime()) > PAYMENT_CONFIRM_TIMEOUT_MS;

  return (
    <div className="space-y-4 pb-8">
      <button onClick={() => router.back()} className="text-slate-400 hover:text-white text-sm transition">← Back</button>

      {/* ── Progress timeline ────────────────────────────────────────── */}
      {isActive && (
        <div className="overflow-x-auto">
          <StatusTimeline status={order.status} />
        </div>
      )}

      {/* ── Order summary card ───────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 text-sm space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Amount</span>
          <span className="font-bold text-lg text-white">{amountLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Your role</span>
          <span className={isSeller ? 'text-purple-400 font-medium' : 'text-blue-400 font-medium'}>
            {isSeller ? '🛒 Seller' : '👤 Buyer'}
          </span>
        </div>
        {order.seller_username && (
          <div className="flex justify-between">
            <span className="text-slate-400">{isSeller ? 'Buyer' : 'Seller'}</span>
            <span className="text-slate-300 font-mono">@{order.seller_username}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-400">Order</span>
          <span className="font-mono text-slate-500 text-xs">#{order.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </section>

      {/* ── Meal details (once submitted) ───────────────────────────── */}
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

      {err && <p className="text-rose-400 text-sm text-center bg-rose-950/20 border border-rose-800 rounded-xl p-3">{err}</p>}

      {/* ════════════════════════════════════════════════════════════════
          STATUS-SPECIFIC ACTION PANELS
          ════════════════════════════════════════════════════════════════ */}

      {/* ── STEP 1: Buyer → choose your meal (LOCKED) ───────────────── */}
      {isBuyer && order.status === 'LOCKED' && (
        <section className="rounded-2xl border-2 border-blue-600 bg-blue-950/20 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔒</span>
            <div>
              <h2 className="font-bold text-blue-300 text-lg">Step 1 — Choose your meal</h2>
              <p className="text-slate-400 text-sm mt-0.5">Select what you want from the Ortega menu. You have a short window before the lock expires.</p>
            </div>
          </div>
          {lockSecs > 0 && (
            <p className="text-sm text-amber-400 bg-amber-950/30 border border-amber-800 rounded-xl px-3 py-2">
              ⏱ Lock expires in <Cd until={order.lock_expires_at} /> — choose before it runs out!
            </p>
          )}
          {!order.order_items && (
            <button onClick={() => router.push(`/orders/${id}/customize`)}
              className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-base transition active:scale-95">
              🍽️ Choose your meal →
            </button>
          )}
        </section>
      )}

      {/* ── STEP 1: Seller view while buyer customizes (LOCKED) ────── */}
      {isSeller && order.status === 'LOCKED' && (
        <section className="rounded-2xl border border-slate-600 bg-slate-800/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            <p className="font-semibold text-slate-300">Buyer is choosing their meal…</p>
          </div>
          <p className="text-slate-500 text-sm">They have a few minutes to customize their order. You'll be notified when they're done.</p>
          <p className="text-slate-600 text-xs">Page refreshes automatically every 15 seconds.</p>
        </section>
      )}

      {/* ── STEP 2: Buyer → send payment (BUYER_SUBMITTED) ──────────── */}
      {isBuyer && order.status === 'BUYER_SUBMITTED' && (
        <section className="space-y-3">
          {/* Trust warning */}
          <div className="rounded-xl border border-amber-700 bg-amber-950/20 px-4 py-3 text-sm">
            <p className="text-amber-300 font-semibold">⚠️ Send payment ONLY after confirming all details above</p>
            <p className="text-amber-200/70 text-xs mt-0.5">Do not send to anyone who contacts you outside the app.</p>
          </div>

          {/* Payment methods */}
          <div className="rounded-2xl border-2 border-emerald-700 bg-emerald-950/20 p-5 space-y-4">
            <div>
              <h2 className="font-bold text-emerald-300 text-lg">Step 2 — Send payment</h2>
              <p className="text-slate-400 text-sm mt-0.5">
                Send <span className="text-white font-bold">{amountLabel}</span> to the seller using any method below.
              </p>
            </div>

            {paymentMethods.length === 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 text-center space-y-1">
                <p className="text-slate-400 text-sm">The seller hasn't set up payment methods yet.</p>
                <p className="text-slate-500 text-xs">Message them in chat below to arrange payment.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {paymentMethods.map(pm => {
                  const meta = PM_META[pm.method];
                  if (!meta) return null;
                  return (
                    <div key={pm.method}
                      className="flex items-center gap-3 rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-3">
                      <span className="text-xl">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-500 uppercase tracking-widest">{meta.label}</p>
                        <p className="text-white font-mono font-semibold text-sm truncate">
                          {meta.prefix}{pm.handle}
                        </p>
                      </div>
                      <span className="text-slate-600 text-xs">→ Send here</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="border-t border-slate-700 pt-4">
              <p className="text-slate-400 text-sm mb-3">Once you've sent the payment, tap the button below. The seller will verify and then upload your QR code.</p>
              <button onClick={() => setPaySheet(true)}
                className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-base transition active:scale-95">
                💸 I Sent Payment →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* "I Sent Payment" confirmation sheet */}
      {paySheet && isBuyer && order.status === 'BUYER_SUBMITTED' && (
        <section className="rounded-2xl border-2 border-emerald-600 bg-emerald-950/30 p-5 space-y-4">
          <h3 className="font-bold text-emerald-300 text-base">Confirm payment sent</h3>
          <p className="text-slate-400 text-sm">
            You're confirming you sent <strong className="text-white">{amountLabel}</strong> to the seller.
            The seller must verify receipt before your QR code is released.
          </p>

          {/* Optional screenshot */}
          <div className="space-y-2">
            <p className="text-slate-400 text-sm font-medium">📸 Add payment screenshot <span className="text-slate-600 font-normal">(optional but helpful)</span></p>
            <p className="text-slate-500 text-xs">A screenshot of your Venmo/Zelle/etc confirmation adds trust and helps resolve disputes.</p>
            <input ref={ssFileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setSsFile(f); }} />
            {ssFile ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-emerald-700">
                <span className="text-emerald-400 text-sm">✓ {ssFile.name}</span>
                <button onClick={() => setSsFile(null)} className="ml-auto text-slate-500 hover:text-white text-xs">remove</button>
              </div>
            ) : (
              <button onClick={() => ssFileRef.current?.click()}
                className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 text-sm transition">
                📁 Attach screenshot
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => { setPaySheet(false); setSsFile(null); }}
              className="flex-1 py-3 rounded-xl border border-slate-600 text-slate-400 hover:text-white text-sm transition">
              Cancel
            </button>
            <button disabled={payBusy} onClick={submitPaymentSent}
              className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-bold text-sm transition">
              {payBusy ? '…' : '✓ Yes, I sent it'}
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 2: Seller → waiting for buyer to pay (BUYER_SUBMITTED) */}
      {isSeller && order.status === 'BUYER_SUBMITTED' && (
        <section className="rounded-2xl border border-slate-600 bg-slate-800/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <p className="font-semibold text-slate-300">Waiting for buyer to send payment</p>
          </div>
          <p className="text-slate-500 text-sm">
            The buyer is reviewing your payment methods and will send{' '}
            <span className="text-white font-bold">{amountLabel}</span>.
            You'll get a notification when they tap "I Sent Payment."
          </p>
          {paymentMethods.length === 0 && (
            <div className="rounded-xl border border-amber-700 bg-amber-950/20 p-3 space-y-2">
              <p className="text-amber-300 text-sm font-semibold">⚠️ You have no payment methods set up!</p>
              <p className="text-amber-200/70 text-xs">Go to your profile to add Venmo, Zelle, or other payment handles so buyers know where to send money.</p>
              <button onClick={() => router.push('/profile')}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white transition">
                Set up payment methods →
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── STEP 3: Buyer → waiting for seller to confirm (PAYMENT_SENT) */}
      {isBuyer && order.status === 'PAYMENT_SENT' && (
        <section className="rounded-2xl border border-blue-700 bg-blue-950/20 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse shrink-0" />
            <h2 className="font-bold text-blue-300">Waiting for seller to confirm payment</h2>
          </div>
          <p className="text-slate-400 text-sm">
            You tapped "I Sent Payment"
            {order.payment_sent_at && <span className="text-slate-500"> ({timeAgo(order.payment_sent_at)})</span>}.
            The seller needs to verify receipt and confirm — then the QR code will be sent to you.
          </p>
          {paymentStale && (
            <div className="rounded-xl border border-amber-700 bg-amber-950/20 p-3 space-y-2">
              <p className="text-amber-300 text-sm font-semibold">⏰ Seller hasn't responded in 4 hours</p>
              <p className="text-amber-200/70 text-xs">Try the chat below. If you can't reach them, you can cancel and report the issue.</p>
            </div>
          )}
          {!paymentStale && (
            <p className="text-slate-500 text-xs">Page refreshes every 15s. Use chat below if you need to reach the seller.</p>
          )}
        </section>
      )}

      {/* ── STEP 3: Seller → confirm payment received (PAYMENT_SENT) ── */}
      {isSeller && order.status === 'PAYMENT_SENT' && !dispOpen && (
        <section className="rounded-2xl border-2 border-amber-600 bg-amber-950/20 p-5 space-y-4">
          <div>
            <h2 className="font-bold text-amber-300 text-lg">Step 3 — Did you receive payment?</h2>
            <p className="text-slate-400 text-sm mt-1">
              The buyer says they sent <strong className="text-white">{amountLabel}</strong>.
              Check your Venmo / Zelle / etc — then confirm or report an issue.
            </p>
            {order.payment_sent_at && (
              <p className="text-slate-500 text-xs mt-1">Buyer sent this {timeAgo(order.payment_sent_at)}</p>
            )}
          </div>

          {/* Payment screenshot if provided */}
          {order.payment_screenshot_url && (
            <div className="rounded-xl border border-slate-600 bg-slate-800/40 p-3 space-y-1">
              <p className="text-slate-400 text-xs">📸 Buyer attached a payment screenshot</p>
              <p className="text-slate-500 text-xs">(Screenshot stored securely — contact support to view it)</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button disabled={busy === 'payment-confirm'} onClick={() => act('payment-confirm')}
              className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-bold text-base transition active:scale-95">
              {busy === 'payment-confirm' ? '…' : '✅ Yes, I received payment → Upload QR'}
            </button>
            <button onClick={() => setDispOpen(true)}
              className="w-full py-2.5 rounded-xl border border-rose-800 text-rose-400 hover:bg-rose-950/30 font-medium text-sm transition">
              ❌ I did NOT receive payment — report issue
            </button>
          </div>
        </section>
      )}

      {/* Dispute sheet (seller) */}
      {isSeller && order.status === 'PAYMENT_SENT' && dispOpen && (
        <section className="rounded-2xl border-2 border-rose-700 bg-rose-950/20 p-5 space-y-4">
          <h3 className="font-bold text-rose-300">Report: Payment not received</h3>
          <p className="text-slate-400 text-sm">This will flag the order as disputed, notify the buyer, and create a moderation report. The QR will remain locked.</p>
          <textarea value={dispNote} onChange={e => setDispNote(e.target.value)} rows={3}
            placeholder="Describe the issue (optional)…"
            className="w-full rounded-xl bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 resize-none focus:outline-none focus:border-rose-600" />
          <div className="flex gap-2">
            <button onClick={() => setDispOpen(false)}
              className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-400 hover:text-white text-sm transition">
              Go back
            </button>
            <button disabled={dispBusy} onClick={submitDispute}
              className="flex-1 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 disabled:opacity-60 text-white font-semibold text-sm transition">
              {dispBusy ? '…' : 'Submit dispute'}
            </button>
          </div>
        </section>
      )}

      {/* ── STEP 4: Buyer → payment confirmed, waiting for QR (PAYMENT_CONFIRMED) */}
      {isBuyer && order.status === 'PAYMENT_CONFIRMED' && (
        <section className="rounded-2xl border border-purple-700 bg-purple-950/20 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-purple-400 rounded-full animate-pulse shrink-0" />
            <h2 className="font-bold text-purple-300">Payment confirmed — QR coming soon!</h2>
          </div>
          <p className="text-slate-400 text-sm">
            The seller confirmed your payment. They're uploading the Ortega QR code now.
            You'll get a notification as soon as it's ready.
          </p>
          <p className="text-slate-500 text-xs">Page refreshes every 15s.</p>
        </section>
      )}

      {/* ── STEP 4: Seller → upload QR (PAYMENT_CONFIRMED) ─────────── */}
      {isSeller && order.status === 'PAYMENT_CONFIRMED' && (
        <section className="rounded-2xl border-2 border-purple-500 bg-purple-950/20 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📲</span>
            <h2 className="font-bold text-purple-300 text-lg">Step 4 — Upload your Ortega QR</h2>
          </div>
          <div className="bg-slate-800/60 border border-slate-600 rounded-xl p-3 text-xs text-slate-400 space-y-1">
            <p>📍 Open your Ortega Dining app → go to the QR Code tab</p>
            <p>📸 Take a clear screenshot so the QR scans correctly</p>
            <p>🔒 The buyer gets a 5-minute view window — they'll screenshot it themselves</p>
            <p>✅ Only share here — never send QRs in chat or outside the app</p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadQr(f); e.target.value = ''; }} />
          <button disabled={upLoad} onClick={() => fileRef.current?.click()}
            className="w-full py-4 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-60 font-bold transition active:scale-95">
            {upLoad ? '⏳ Uploading…' : order.qr_image_url ? '✓ Re-upload QR' : '📤 Upload QR screenshot'}
          </button>
          {order.qr_image_url && (
            <p className="text-emerald-400 text-sm text-center">✓ QR uploaded — buyer has been notified!</p>
          )}
        </section>
      )}

      {/* ── STEP 5: Buyer → view QR (QR_UPLOADED) ──────────────────── */}
      {isBuyer && order.qr_image_url && ['QR_UPLOADED', 'COMPLETED'].includes(order.status) && (
        <section className="rounded-2xl border-2 border-emerald-600 bg-emerald-950/20 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎟️</span>
            <h2 className="font-bold text-emerald-300 text-lg">Your Ortega QR is ready!</h2>
          </div>
          <p className="text-slate-400 text-sm">Show this QR at the Ortega register. Screenshot it — it expires 5 minutes after you tap "Show QR."</p>
          {!qrUrl
            ? <button disabled={qrLoad} onClick={viewQr}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-bold transition">
                {qrLoad ? '…' : '👁️ Show QR code'}
              </button>
            : <div className="space-y-2">
                <img src={qrUrl} alt="Ortega QR" className="w-full rounded-xl border border-slate-600 shadow-lg" />
                <button onClick={() => setQrUrl('')}
                  className="w-full py-2 rounded-xl border border-slate-600 text-slate-400 text-sm hover:text-white transition">
                  Hide QR
                </button>
              </div>
          }
        </section>
      )}

      {/* ── STEP 5: Seller → waiting for buyer to confirm (QR_UPLOADED) */}
      {isSeller && order.status === 'QR_UPLOADED' && (
        <section className="rounded-2xl border border-slate-600 bg-slate-800/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <p className="font-semibold text-slate-300">QR delivered — waiting for buyer to confirm pickup</p>
          </div>
          <p className="text-slate-500 text-sm">Once the buyer visits Ortega and uses the QR, they'll mark the order complete. You're all done on your end!</p>
        </section>
      )}

      {/* ── DISPUTED state ───────────────────────────────────────────── */}
      {order.status === 'DISPUTED' && (
        <section className="rounded-2xl border border-rose-700 bg-rose-950/20 p-5 space-y-3">
          <p className="text-2xl">⚠️</p>
          <p className="font-bold text-rose-300 text-lg">Payment dispute flagged</p>
          <p className="text-slate-400 text-sm">
            {isSeller
              ? 'You reported a payment issue. A moderation report has been filed. You can cancel this order or wait for the buyer to resolve it via chat.'
              : 'The seller flagged a payment issue. Please use the chat to clarify your payment, or contact support. You may also cancel if needed.'}
          </p>
        </section>
      )}

      {/* ── CANCELLED state ──────────────────────────────────────────── */}
      {order.status === 'CANCELLED' && (
        <section className="rounded-2xl border border-slate-600 bg-slate-800/20 p-5 space-y-2">
          <p className="text-2xl">❌</p>
          <p className="font-bold text-slate-300">Order cancelled</p>
          <p className="text-slate-500 text-sm">This order was cancelled. If you had already sent payment, contact support.</p>
          <button onClick={() => router.push('/board')}
            className="text-sm text-blue-400 hover:text-blue-300 transition">← Browse listings</button>
        </section>
      )}

      {/* ── COMPLETED state ──────────────────────────────────────────── */}
      {order.status === 'COMPLETED' && (
        <section className="rounded-2xl border border-emerald-700 bg-emerald-950/20 p-5 space-y-2">
          <p className="text-2xl">🎉</p>
          <p className="font-bold text-emerald-300 text-lg">Order complete!</p>
          <p className="text-slate-400 text-sm">
            {isBuyer ? 'Enjoy your meal! Thanks for using GauchoGrub.' : 'Transaction done! Thanks for selling on GauchoGrub.'}
          </p>
        </section>
      )}

      {/* ── Buyer: confirm pickup (QR_UPLOADED) ─────────────────────── */}
      {isBuyer && order.status === 'QR_UPLOADED' && (
        <button disabled={busy === 'complete'} onClick={() => act('complete', 'Confirm you successfully picked up your meal at Ortega?')}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-semibold transition">
          {busy === 'complete' ? '…' : '✓ I picked up my meal — mark complete'}
        </button>
      )}

      {/* ── Cancel button (active orders only) ──────────────────────── */}
      {isActive && !cancelOpen && (
        <button onClick={() => setCancelOpen(true)}
          className="w-full py-3 rounded-xl border border-rose-800 text-rose-400 hover:bg-rose-950/30 font-medium text-sm transition">
          Cancel order
        </button>
      )}

      {isActive && cancelOpen && (
        <section className="rounded-2xl border border-rose-800 bg-rose-950/20 p-4 space-y-3">
          {/* Context-specific warning for payment states */}
          {['PAYMENT_SENT', 'PAYMENT_CONFIRMED', 'QR_UPLOADED'].includes(order.status) && (
            <div className="rounded-xl border border-amber-700 bg-amber-950/30 p-3">
              <p className="text-amber-300 text-sm font-semibold">
                {isBuyer && order.status === 'PAYMENT_SENT'
                  ? '⚠️ You marked payment as sent. Cancelling will not automatically refund you.'
                  : isBuyer && order.status === 'PAYMENT_CONFIRMED'
                  ? '⚠️ The seller confirmed your payment. Cancelling at this stage may be difficult to resolve.'
                  : '⚠️ Cancelling after payment is confirmed — please coordinate via chat first.'}
              </p>
            </div>
          )}
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
            <textarea value={cancelText} onChange={e => setCancelText(e.target.value)}
              placeholder="Any additional details… (optional)"
              maxLength={500} rows={2}
              className="w-full rounded-xl bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 resize-none focus:outline-none focus:border-rose-600" />
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

      {/* ════════════════════════════════════════════════════════════════
          IN-ORDER CHAT
          ════════════════════════════════════════════════════════════════ */}
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 overflow-hidden">
        <button
          onClick={() => { setChatOpen(o => !o); if (!chatOpen) loadMessages(); }}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition">
          <div className="flex items-center gap-2">
            <span className="text-lg">💬</span>
            <span className="font-semibold text-sm text-slate-200">Order Chat</span>
            {msgs.length > 0 && (
              <span className="text-xs text-slate-500 font-normal">{msgs.length} message{msgs.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <span className="text-slate-500 text-sm">{chatOpen ? '▲' : '▼'}</span>
        </button>

        {chatOpen && (
          <div className="border-t border-slate-700">
            {/* Messages */}
            <div className="max-h-72 overflow-y-auto p-3 space-y-2">
              {msgs.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-4">No messages yet. Use chat to discuss timing, Ortega options, or payment.</p>
              ) : (
                msgs.map(m => {
                  const isMe = m.sender_id === myId;
                  return (
                    <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm space-y-0.5
                        ${isMe ? 'bg-blue-700 text-white rounded-br-none' : 'bg-slate-700 text-slate-100 rounded-bl-none'}`}>
                        {!isMe && <p className="text-[10px] font-semibold text-slate-400">@{m.sender_username}</p>}
                        <p className="leading-snug break-words">{m.body}</p>
                        <p className={`text-[9px] ${isMe ? 'text-blue-300' : 'text-slate-500'} text-right`}>{timeAgo(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            {isActive ? (
              <div className="border-t border-slate-700 p-3 flex gap-2">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  placeholder="Message…"
                  maxLength={2000}
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button disabled={chatBusy || !chatInput.trim()} onClick={sendChat}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold transition">
                  {chatBusy ? '…' : '↑'}
                </button>
              </div>
            ) : (
              <p className="text-center text-slate-600 text-xs py-3 border-t border-slate-700">Chat is closed for completed/cancelled orders</p>
            )}
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════════
          REVIEWS (COMPLETED only)
          ════════════════════════════════════════════════════════════════ */}
      {order.status === 'COMPLETED' && (
        <>
          {isBuyer && review === null && (
            <section className="rounded-2xl border border-yellow-700 bg-yellow-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">⭐</span>
                <h2 className="font-bold text-yellow-300">Rate your seller</h2>
              </div>
              <p className="text-slate-400 text-sm">How did the transaction go? Your feedback helps the community.</p>
              <StarPicker value={rvRating} onChange={setRvRating} />
              <textarea value={rvBody} onChange={e => setRvBody(e.target.value)}
                placeholder="Optional note (max 500 chars)…" maxLength={500} rows={3}
                className="w-full rounded-xl bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 resize-none focus:outline-none focus:border-yellow-600" />
              {rvErr && <p className="text-rose-400 text-sm">{rvErr}</p>}
              <button disabled={rvBusy} onClick={submitReview}
                className="w-full py-3 rounded-xl bg-yellow-600 hover:bg-yellow-500 disabled:opacity-60 font-bold text-sm transition">
                {rvBusy ? '…' : '⭐ Submit review'}
              </button>
            </section>
          )}
          {isBuyer && review != null && (
            <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-1">
              <p className="text-sm font-semibold text-slate-300">Your review</p>
              <p className="text-yellow-400 text-xl tracking-wide">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</p>
              {review.body && <p className="text-slate-400 text-sm italic">"{review.body}"</p>}
            </section>
          )}
          {isSeller && review != null && (
            <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-1">
              <p className="text-sm font-semibold text-slate-300">Buyer's review</p>
              <p className="text-yellow-400 text-xl tracking-wide">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</p>
              {review.body && <p className="text-slate-400 text-sm italic">"{review.body}"</p>}
            </section>
          )}
        </>
      )}

      {/* ── Report button ────────────────────────────────────────────── */}
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
          <p className="text-slate-500 text-xs">Reports are private and reviewed only by our team.</p>
          <div className="space-y-1.5">
            {[
              { code: 'no_show',               label: 'No-show' },
              { code: 'payment_not_received',  label: 'Payment not received / scam' },
              { code: 'harassment',            label: 'Harassment / rude behavior' },
              { code: 'spam_fake_listing',     label: 'Spam / fake listing' },
              { code: 'scam_suspicious',       label: 'Suspicious activity' },
              { code: 'repeated_cancellations', label: 'Repeated cancellations' },
              { code: 'other',                 label: 'Other' },
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
          <textarea value={reportMsg} onChange={e => setReportMsg(e.target.value)}
            placeholder="Describe what happened (min 10 characters)…"
            maxLength={1000} rows={3}
            className="w-full rounded-xl bg-slate-800 border border-slate-600 text-sm text-white placeholder-slate-500 px-3 py-2 resize-none focus:outline-none focus:border-slate-500" />
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
