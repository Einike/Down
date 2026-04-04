import { supabase } from './supabaseClient';

/** Attach the current session token to a fetch call. */
export async function authedFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  let { data } = await supabase.auth.getSession();

  // If the token is expired or about to expire (within 60s), proactively refresh.
  // This is especially important on mobile where the auto-refresh timer stops when
  // the browser/app is backgrounded.
  if (data.session) {
    const expiresAt = data.session.expires_at ?? 0;
    const nowSecs   = Math.floor(Date.now() / 1000);
    if (expiresAt - nowSecs < 60) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session) data = refreshed;
    }
  }

  const token = data.session?.access_token;
  const isForm   = opts.body instanceof FormData;

  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> ?? {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  return fetch(url, { ...opts, headers });
}

/** Returns a valid (refreshed if needed) access token. Use for manual file upload fetches. */
export async function getValidToken(): Promise<string | undefined> {
  let { data } = await supabase.auth.getSession();
  if (data.session) {
    const expiresAt = data.session.expires_at ?? 0;
    const nowSecs   = Math.floor(Date.now() / 1000);
    if (expiresAt - nowSecs < 60) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session) data = refreshed;
    }
  }
  return data.session?.access_token;
}

/** Parse JSON from response, throw a readable Error if not OK. */
export async function jsonOrThrow<T>(res: Response): Promise<T> {
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body?.error as string) ?? `Request failed (${res.status})`);
  return body as T;
}
