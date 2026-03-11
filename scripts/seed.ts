/**
 * Seed test accounts for local development.
 * Run: npm run seed
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DB  = process.env.SUPABASE_DB_URL!;

if (!URL || !KEY || !DB) {
  console.error('❌  Missing env vars. Check .env.local has:');
  console.error('    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL');
  process.exit(1);
}

const ACCOUNTS = [
  { email: 'seller_test@ucsb.edu',  password: 'TestPass123!', username: 'seller_test'  },
  { email: 'buyer_test@ucsb.edu',   password: 'TestPass123!', username: 'buyer_test'   },
  { email: 'buyer2_test@ucsb.edu',  password: 'TestPass123!', username: 'buyer2_test'  },
];

(async () => {
  const admin = createClient(URL, KEY, { auth: { persistSession: false } });
  const pg    = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  console.log('\n🌱  Seeding test accounts…\n');

  for (const acc of ACCOUNTS) {
    const { data: list } = await admin.auth.admin.listUsers();
    const found = list?.users.find(u => u.email === acc.email);
    let uid: string;

    if (found) {
      uid = found.id;
      await admin.auth.admin.updateUserById(uid, { password: acc.password });
      console.log(`✓  Updated  ${acc.email}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: acc.email, password: acc.password, email_confirm: true,
      });
      if (error) { console.error(`✗  ${acc.email}: ${error.message}`); continue; }
      uid = data.user.id;
      console.log(`✓  Created  ${acc.email}`);
    }

    await pg.query(
      `INSERT INTO profiles(id,email,username)
       VALUES($1,$2,$3)
       ON CONFLICT(id) DO UPDATE SET username=$3, email=$2`,
      [uid, acc.email, acc.username]
    );
    console.log(`   @${acc.username}`);
  }

  await pg.end();
  console.log('\n✅  Seed complete → http://localhost:3000/dev/login\n');
})();
