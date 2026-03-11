import { NextRequest } from 'next/server';
import { admin } from './supabaseAdmin';

export interface AuthUser {
  id:    string;
  email: string;
}

/**
 * Extracts and verifies the Bearer token from the Authorization header.
 * Also enforces @ucsb.edu domain in production and blocks banned accounts.
 * Throws with a human-readable message on failure.
 */
export async function requireUser(req: NextRequest): Promise<AuthUser> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new Error('Authentication required');

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error('Session expired — please log in again');

  const email = data.user.email ?? '';
  const isDev = process.env.APP_ENV !== 'production';
  if (!isDev && !email.endsWith('@ucsb.edu')) {
    throw new Error('Only @ucsb.edu accounts are allowed');
  }

  // Ban check — runs after auth so banned users can still reach the login page
  // (login/signup go through Supabase Auth directly, not requireUser)
  const { data: profile } = await admin
    .from('profiles')
    .select('is_banned, banned_until, role')
    .eq('id', data.user.id)
    .single();

  if (profile?.is_banned) {
    const permanent   = !profile.banned_until;
    const stillBanned = permanent || new Date(profile.banned_until) > new Date();

    if (stillBanned) {
      const until = permanent
        ? ''
        : ` until ${new Date(profile.banned_until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
      throw Object.assign(
        new Error(`Your account has been suspended${until}. Contact support if you believe this is an error.`),
        { status: 403 },
      );
    }

    // Ban window expired — auto-lift
    await admin.from('profiles')
      .update({ is_banned: false, banned_until: null })
      .eq('id', data.user.id);
  }

  return { id: data.user.id, email };
}
