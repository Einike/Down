import { NextRequest } from 'next/server';
import { admin } from './supabaseAdmin';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export async function requireAdmin(req: NextRequest): Promise<{ id: string; email: string }> {
  const auth  = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw Object.assign(new Error('Authentication required'), { status: 401 });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error('Session expired'), { status: 401 });

  const email = (data.user.email ?? '').toLowerCase();

  // Always enforce admin allow-list regardless of environment.
  // Never use a dev bypass here — admin routes control bans, exports, and force-cancels.
  if (!ADMIN_EMAILS.includes(email)) {
    throw Object.assign(new Error('Admin access required'), { status: 403 });
  }

  return { id: data.user.id, email };
}
