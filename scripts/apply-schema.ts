/**
 * Apply all SQL migrations in order.
 * Loads .env.local automatically.
 * Fails fast on any migration error (does NOT silently continue).
 */
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local BEFORE reading process.env
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') }); // fallback

import { Client } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error('❌  SUPABASE_DB_URL required.');
  console.error('    Add it to .env.local (see .env.local.example)');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const dir   = join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  console.log(`\n📦 Applying ${files.length} migrations…\n`);
  let applied = 0;

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    process.stdout.write(`  ▶ ${file} … `);
    try {
      await client.query(sql);
      console.log('✓');
      applied++;
    } catch (e: any) {
      console.log('');
      console.error(`\n❌  Migration failed: ${file}`);
      console.error(`    ${e.message.split('\n')[0]}`);
      console.error('\n    Fix the migration and re-run. Stopping.');
      await client.end();
      process.exit(1); // FAIL FAST — do not continue on error
    }
  }

  await client.end();
  console.log(`\n✅  ${applied}/${files.length} migrations applied successfully.\n`);
})();
