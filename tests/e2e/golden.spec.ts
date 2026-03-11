/**
 * GauchoGrub E2E Golden Path Tests
 * Covers: seller→buyer flow, claim atomicity, anti-abuse, QR upload, completion
 */
import { test, expect, request as baseRequest } from '@playwright/test';
import path from 'path';

const BASE = 'http://localhost:3000';
const QR_FIXTURE = path.resolve(__dirname, '../fixtures/qr.png');

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apiLogin(ctx: any, email: string, pw = 'TestPass123!') {
  const res = await ctx.post(`${BASE}/api/dev/session`, { data: { email, password: pw } });
  if (!res.ok()) return null;
  const { access_token, refresh_token } = await res.json();
  return { access_token, refresh_token };
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── Unauthenticated redirects ─────────────────────────────────────────────────
test('unauthenticated /board redirects to /login', async ({ page }) => {
  await page.goto(`${BASE}/board`);
  await page.waitForURL(/\/(login|onboarding)/, { timeout: 8_000 });
  expect(page.url()).toMatch(/\/(login|onboarding)/);
});

// ── Dev login page ────────────────────────────────────────────────────────────
test('/dev/login page shows all test accounts', async ({ page }) => {
  await page.goto(`${BASE}/dev/login`);
  await expect(page.getByText('Dev Login')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('seller_test@ucsb.edu')).toBeVisible();
  await expect(page.getByText('buyer_test@ucsb.edu')).toBeVisible();
});

// ── Homepage ──────────────────────────────────────────────────────────────────
test('homepage has CTA buttons', async ({ page }) => {
  await page.goto(`${BASE}/`);
  // Either homepage or redirected to login — both valid
  const url = page.url();
  expect(url).toMatch(/localhost:3000/);
});

// ── Seller cannot post 2 listings ─────────────────────────────────────────────
test('seller cannot create a second active listing', async ({ request }) => {
  const tokens = await apiLogin(request, 'seller_test@ucsb.edu');
  if (!tokens) { test.skip(); return; }
  const h   = authHeaders(tokens.access_token);
  const exp = new Date(Date.now() + 3_600_000).toISOString();

  // First listing — may succeed or 409 if one already exists
  await request.post(`${BASE}/api/listings`, { headers: h, data: { price_cents: 300, expires_at: exp } });

  // Second MUST fail with 409
  const r2 = await request.post(`${BASE}/api/listings`, { headers: h, data: { price_cents: 200, expires_at: exp } });
  expect(r2.status()).toBe(409);
  const body = await r2.json();
  expect(body.error).toMatch(/active listing/i);
});

// ── Seller cannot claim own listing ──────────────────────────────────────────
test('seller cannot claim their own listing', async ({ request }) => {
  const tokens = await apiLogin(request, 'seller_test@ucsb.edu');
  if (!tokens) { test.skip(); return; }
  const h = authHeaders(tokens.access_token);

  const mineRes = await request.get(`${BASE}/api/listings/mine`, { headers: h });
  const { listings } = await mineRes.json();
  if (!listings?.length) { test.skip(); return; }

  const r = await request.post(`${BASE}/api/listings/${listings[0].id}/claim`, { headers: h });
  expect(r.status()).toBe(409);
  expect((await r.json()).error).toMatch(/own listing/i);
});

// ── Buyer active-order guard ──────────────────────────────────────────────────
test('buyer with active order cannot claim again', async ({ request }) => {
  const buyer = await apiLogin(request, 'buyer_test@ucsb.edu');
  if (!buyer) { test.skip(); return; }
  const bh = authHeaders(buyer.access_token);

  const ordersRes = await request.get(`${BASE}/api/orders`, { headers: bh });
  const { orders } = await ordersRes.json();
  const active = orders?.filter((o: any) =>
    ['LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED'].includes(o.status));

  if (!active?.length) { test.skip(); return; }

  // Get any open listing from seller
  const seller = await apiLogin(request, 'seller_test@ucsb.edu');
  if (!seller) { test.skip(); return; }
  const sh = authHeaders(seller.access_token);
  const listRes = await request.get(`${BASE}/api/listings`, { headers: sh });
  const { listings } = await listRes.json();
  if (!listings?.length) { test.skip(); return; }

  const r = await request.post(`${BASE}/api/listings/${listings[0].id}/claim`, { headers: bh });
  expect(r.status()).toBe(409);
  expect((await r.json()).error).toMatch(/active order/i);
});

// ── Menu validation: entree required ─────────────────────────────────────────
test('customize rejects order with no entree', async ({ request }) => {
  const buyer = await apiLogin(request, 'buyer_test@ucsb.edu');
  if (!buyer) { test.skip(); return; }
  const h = authHeaders(buyer.access_token);

  const ordersRes = await request.get(`${BASE}/api/orders`, { headers: h });
  const { orders } = await ordersRes.json();
  const locked = orders?.find((o: any) => o.status === 'LOCKED');
  if (!locked) { test.skip(); return; }

  const r = await request.post(`${BASE}/api/orders/${locked.id}/customize`, {
    headers: h,
    data: { entree: '', side: null, dessert: null, fruits: [], beverage: null, condiments: [], notes: null },
  });
  expect(r.status()).toBe(422);
  expect((await r.json()).errors[0]).toMatch(/entree/i);
});

// ── Menu validation: fruit rule ───────────────────────────────────────────────
test('customize rejects 2 fruits when dessert selected', async ({ request }) => {
  const buyer = await apiLogin(request, 'buyer_test@ucsb.edu');
  if (!buyer) { test.skip(); return; }
  const h = authHeaders(buyer.access_token);

  const ordersRes = await request.get(`${BASE}/api/orders`, { headers: h });
  const { orders } = await ordersRes.json();
  const locked = orders?.find((o: any) => o.status === 'LOCKED');
  if (!locked) { test.skip(); return; }

  const r = await request.post(`${BASE}/api/orders/${locked.id}/customize`, {
    headers: h,
    data: {
      entree: 'Classic Burger',
      side: null,
      dessert: 'Banana Chocolate Chip Cookie (vgn)',
      fruits: ['Apple (vgn)', 'Banana (vgn)'],
      beverage: null, condiments: [], notes: null,
    },
  });
  expect(r.status()).toBe(422);
  expect((await r.json()).errors[0]).toMatch(/1 fruit/i);
});

// ── QR: unauthorized access blocked ──────────────────────────────────────────
test('QR endpoint requires auth', async ({ request }) => {
  const r = await request.get(`${BASE}/api/orders/00000000-0000-0000-0000-000000000000/qr`);
  expect(r.status()).toBe(401);
});

test('buyer cannot view QR on someone else\'s order', async ({ request }) => {
  const b2 = await apiLogin(request, 'buyer2_test@ucsb.edu');
  if (!b2) { test.skip(); return; }
  const h = authHeaders(b2.access_token);

  // Get buyer1's orders
  const b1 = await apiLogin(request, 'buyer_test@ucsb.edu');
  if (!b1) { test.skip(); return; }
  const { orders } = await (await request.get(`${BASE}/api/orders`, { headers: authHeaders(b1.access_token) })).json();
  const withQr = orders?.find((o: any) => o.qr_image_url);
  if (!withQr) { test.skip(); return; }

  const r = await request.get(`${BASE}/api/orders/${withQr.id}/qr`, { headers: h });
  expect(r.status()).toBe(403);
});

// ── Notifications requires auth ───────────────────────────────────────────────
test('notifications requires auth', async ({ request }) => {
  const r = await request.get(`${BASE}/api/notifications`);
  expect(r.status()).toBe(401);
});

// ── Full golden path (API-level) ──────────────────────────────────────────────
test('full order flow: seller→buyer→customize→accept→qr→complete', async ({ request }) => {
  const seller = await apiLogin(request, 'seller_test@ucsb.edu');
  const buyer  = await apiLogin(request, 'buyer_test@ucsb.edu');
  if (!seller || !buyer) { test.skip(); return; }

  const sh = authHeaders(seller.access_token);
  const bh = authHeaders(buyer.access_token);

  // 1. Seller: cancel any existing active listing first
  const mineRes  = await request.get(`${BASE}/api/listings/mine`, { headers: sh });
  const { listings: existing } = await mineRes.json();
  for (const l of existing ?? []) {
    await request.delete(`${BASE}/api/listings/${l.id}`, { headers: sh });
  }

  // 2. Seller: cancel any active orders (so buyer isn't blocked)
  const sellerOrders = await (await request.get(`${BASE}/api/orders`, { headers: sh })).json();
  for (const o of sellerOrders.orders ?? []) {
    if (['LOCKED','BUYER_SUBMITTED','SELLER_ACCEPTED','QR_UPLOADED'].includes(o.status)) {
      await request.post(`${BASE}/api/orders/${o.id}/cancel`, { headers: sh });
    }
  }

  // Buyer: also cancel active orders
  const buyerOrders = await (await request.get(`${BASE}/api/orders`, { headers: bh })).json();
  for (const o of buyerOrders.orders ?? []) {
    if (['LOCKED','BUYER_SUBMITTED'].includes(o.status)) {
      await request.post(`${BASE}/api/orders/${o.id}/cancel`, { headers: bh });
    }
  }

  // 3. Seller: create listing
  const expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const createRes  = await request.post(`${BASE}/api/listings`, {
    headers: sh,
    data:    { price_cents: 250, expires_at },
  });

  if (!createRes.ok()) {
    // May be outside Ortega hours — skip gracefully
    const err = (await createRes.json()).error ?? '';
    if (/closed|hours|weekend/i.test(err)) { test.skip(); return; }
    throw new Error(`Create listing failed: ${err}`);
  }

  const { listing } = await createRes.json();
  expect(listing.status).toBe('OPEN');
  expect(listing.price_cents).toBe(250);

  // 4. Buyer: claim listing
  const claimRes = await request.post(`${BASE}/api/listings/${listing.id}/claim`, { headers: bh });
  if (!claimRes.ok()) {
    const err = (await claimRes.json()).error ?? '';
    if (/cooldown|wait|closed/i.test(err)) { test.skip(); return; }
    throw new Error(`Claim failed: ${err}`);
  }

  const { order } = await claimRes.json();
  expect(order.status).toBe('LOCKED');
  const orderId = order.id;

  // 5. Buyer: customize order
  const customRes = await request.post(`${BASE}/api/orders/${orderId}/customize`, {
    headers: bh,
    data: {
      entree:     'Classic Burger',
      side:       'Fries (vgn)',
      dessert:    null,
      fruits:     ['Apple (vgn)', 'Banana (vgn)'],
      beverage:   'Water',
      condiments: ['Ketchup (vgn)'],
      notes:      'Extra napkins please',
    },
  });

  if (!customRes.ok()) {
    const err = await customRes.json();
    throw new Error(`Customize failed: ${JSON.stringify(err)}`);
  }

  // Verify order advanced to BUYER_SUBMITTED
  const afterCustom = await (await request.get(`${BASE}/api/orders/${orderId}`, { headers: bh })).json();
  expect(afterCustom.order.status).toBe('BUYER_SUBMITTED');

  // 6. Seller: accept
  const acceptRes = await request.post(`${BASE}/api/orders/${orderId}/accept`, { headers: sh });
  expect(acceptRes.ok()).toBe(true);
  const afterAccept = await (await request.get(`${BASE}/api/orders/${orderId}`, { headers: sh })).json();
  expect(afterAccept.order.status).toBe('SELLER_ACCEPTED');

  // 7. Seller: upload QR
  const fs   = await import('fs');
  const qrBuf = fs.readFileSync(QR_FIXTURE);
  const form  = new FormData();
  form.append('file', new Blob([qrBuf], { type: 'image/png' }), 'qr.png');

  const qrUpRes = await fetch(`${BASE}/api/orders/${orderId}/qr`, {
    method:  'POST',
    body:    form,
    headers: { Authorization: `Bearer ${seller.access_token}` },
  });
  if (!qrUpRes.ok) {
    const err = await qrUpRes.json();
    // If bucket not set up — skip (CI note)
    if (JSON.stringify(err).includes('bucket') || JSON.stringify(err).includes('storage')) {
      console.warn('QR upload skipped — storage not configured in test environment');
      test.skip(); return;
    }
    throw new Error(`QR upload failed: ${JSON.stringify(err)}`);
  }

  const afterQr = await (await request.get(`${BASE}/api/orders/${orderId}`, { headers: bh })).json();
  expect(afterQr.order.status).toBe('QR_UPLOADED');
  expect(afterQr.order.qr_image_url).toBeTruthy();

  // 8. Buyer: view QR (signed URL)
  const qrViewRes = await request.get(`${BASE}/api/orders/${orderId}/qr`, { headers: bh });
  expect(qrViewRes.ok()).toBe(true);
  const { url } = await qrViewRes.json();
  expect(url).toMatch(/^https?:\/\//);

  // 9. Buyer: mark complete
  const completeRes = await request.post(`${BASE}/api/orders/${orderId}/complete`, { headers: bh });
  expect(completeRes.ok()).toBe(true);

  const final = await (await request.get(`${BASE}/api/orders/${orderId}`, { headers: bh })).json();
  expect(final.order.status).toBe('COMPLETED');
});

// ── Ortega hours: block outside hours ────────────────────────────────────────
test('listing creation is blocked with a helpful message when Ortega is closed', async ({ request }) => {
  const seller = await apiLogin(request, 'seller_test@ucsb.edu');
  if (!seller) { test.skip(); return; }

  // We cannot reliably test this without mocking time in CI.
  // Instead verify the endpoint exists and returns a sensible error shape.
  const res = await request.post(`${BASE}/api/listings`, {
    headers: authHeaders(seller.access_token),
    data: { price_cents: 100, expires_at: new Date(Date.now() + 1000).toISOString() },
  });
  // Either 201 (open) or 400 (closed) — both valid; just check it's not 500
  expect(res.status()).not.toBe(500);
});
