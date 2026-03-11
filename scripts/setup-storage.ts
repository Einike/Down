/**
 * Creates the 'order-qr' private storage bucket.
 * Run: npm run storage:setup
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!URL || !KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(URL, KEY, { auth: { persistSession: false } });

(async () => {
  console.log('\n🪣  Setting up storage bucket…\n');

  const { data: buckets } = await admin.storage.listBuckets();
  const exists = buckets?.some((b: any) => b.id === 'order-qr');

  if (exists) {
    console.log('✅  Bucket "order-qr" already exists — nothing to do.\n');
    return;
  }

  const { error } = await admin.storage.createBucket('order-qr', {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024, // 10 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  });

  if (error) {
    console.error(`❌  Failed to create bucket: ${error.message}`);
    process.exit(1);
  }

  console.log('✅  Bucket "order-qr" created (private).\n');
  console.log('    Sellers can upload QR codes; only participants can read.\n');
})();
