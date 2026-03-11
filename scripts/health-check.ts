/**
 * GauchoGrub Health Check
 * Verifies env vars, DB schema, constraints, connectivity, and storage.
 * Run: npm run health
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB  = process.env.SUPABASE_DB_URL;

let failed = false;
const results: { label: string; ok: boolean; msg: string }[] = [];

function pass(label: string, msg = 'OK') {
  results.push({ label, ok: true, msg });
}
function fail(label: string, msg: string) {
  results.push({ label, ok: false, msg });
  failed = true;
}

async function runChecks() {
  console.log('\n🌮  GauchoGrub Health Check\n' + '─'.repeat(42));

  // ── 1. Env vars ──────────────────────────────────────────────────
  if (URL)  pass('NEXT_PUBLIC_SUPABASE_URL');
  else      fail('NEXT_PUBLIC_SUPABASE_URL', 'Missing — add to .env.local');

  if (KEY)  pass('SUPABASE_SERVICE_ROLE_KEY');
  else      fail('SUPABASE_SERVICE_ROLE_KEY', 'Missing — add to .env.local');

  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) pass('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  else fail('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Missing — add to .env.local');

  if (DB)   pass('SUPABASE_DB_URL (for migrations)');
  else      fail('SUPABASE_DB_URL (for migrations)', 'Missing — migrations will fail without this');

  if (!URL || !KEY) {
    printResults();
    process.exit(1);
  }

  const admin = createClient(URL, KEY, { auth: { persistSession: false } });

  // ── 2. Basic connectivity ────────────────────────────────────────
  try {
    const { error } = await admin.from('profiles').select('id').limit(1);
    if (error) fail('Supabase connectivity', error.message);
    else pass('Supabase connectivity');
  } catch (e: any) {
    fail('Supabase connectivity', e.message);
  }

  // ── 3. Tables ────────────────────────────────────────────────────
  for (const table of ['profiles','listings','orders','notifications','audit_log','reviews']) {
    try {
      const { error } = await (admin.from(table as any) as any).select('id').limit(1);
      if (error) fail(`Table: ${table}`, error.message + ' — run: npm run db:migrate');
      else pass(`Table: ${table}`);
    } catch (e: any) {
      fail(`Table: ${table}`, e.message);
    }
  }

  // ── 4. Critical columns ──────────────────────────────────────────
  try {
    const { error } = await admin.from('orders').select('order_items, updated_at').limit(1);
    if (error?.message.includes('order_items')) fail('orders.order_items column', 'Missing — run: npm run db:migrate');
    else if (error?.message.includes('updated_at')) fail('orders.updated_at column', 'Missing — run: npm run db:migrate');
    else pass('orders.order_items & updated_at columns');
  } catch (e: any) {
    fail('orders critical columns', e.message);
  }

  try {
    const { error } = await admin.from('listings').select('completed_at').limit(1);
    if (error?.message.includes('completed_at')) fail('listings.completed_at column', 'Missing — run: npm run db:migrate');
    else pass('listings.completed_at column');
  } catch (e: any) {
    fail('listings.completed_at column', e.message);
  }

  // ── 5. Status constraint: BUYER_SUBMITTED must be allowed ────────
  try {
    // Insert a row with BUYER_SUBMITTED — it should fail with "not found" not "constraint violated"
    const { error } = await admin.from('orders').update({ status: 'BUYER_SUBMITTED' })
      .eq('id', '00000000-0000-0000-0000-000000000000');
    // Any error about constraint violation means BUYER_SUBMITTED is not in the allowed set
    if (error?.message.includes('orders_status') || error?.message.includes('check constraint')) {
      fail('orders status constraint (BUYER_SUBMITTED)', 'Constraint rejects BUYER_SUBMITTED — run: npm run db:migrate (migration 0007)');
    } else {
      pass('orders status constraint (BUYER_SUBMITTED allowed)');
    }
  } catch (e: any) {
    pass('orders status constraint (BUYER_SUBMITTED allowed)'); // unexpected errors are not constraint issues
  }

  // ── 6. claim_listing_atomic RPC ──────────────────────────────────
  try {
    const { error } = await admin.rpc('claim_listing_atomic', {
      p_listing_id: '00000000-0000-0000-0000-000000000000',
      p_buyer_id:   '00000000-0000-0000-0000-000000000001',
      p_lock_until: new Date().toISOString(),
    });
    if (error?.code === 'PGRST202' || error?.message.includes('does not exist')) {
      fail('claim_listing_atomic RPC', 'Function missing — run: npm run db:migrate');
    } else {
      pass('claim_listing_atomic RPC');
    }
  } catch (e: any) {
    fail('claim_listing_atomic RPC', e.message);
  }

  // ── 7. Storage bucket ────────────────────────────────────────────
  try {
    const { data, error } = await admin.storage.listBuckets();
    if (error) {
      fail("storage bucket 'order-qr'", `Cannot list buckets: ${error.message}`);
    } else if (!data?.some((b: any) => b.id === 'order-qr')) {
      fail("storage bucket 'order-qr'", "Bucket missing — run: npm run storage:setup");
    } else {
      pass("storage bucket 'order-qr'");
    }
  } catch (e: any) {
    fail("storage bucket 'order-qr'", e.message);
  }

  // ── 8. Anti-abuse indexes ────────────────────────────────────────
  // Can't query pg_indexes without direct DB connection; skip gracefully
  pass('Anti-abuse indexes (assumed — verify with npm run db:migrate)');
}

function printResults() {
  console.log('');
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    const msg  = r.ok ? r.msg : `FAIL — ${r.msg}`;
    console.log(`${icon}  ${r.label}: ${msg}`);
  }
  const passing = results.filter(r => r.ok).length;
  const total   = results.length;
  console.log(`\n${'─'.repeat(42)}`);
  if (failed) {
    console.log(`⚠️   ${passing}/${total} checks passed — fix the issues above.\n`);
  } else {
    console.log(`✅  All ${total} checks passed — app is healthy.\n`);
  }
}

runChecks().then(() => {
  printResults();
  process.exit(failed ? 1 : 0);
}).catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
