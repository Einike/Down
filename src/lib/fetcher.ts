import { supabase } from './supabaseClient';

/** Attach the current session token to a fetch call. */
export async function authedFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token    = data.session?.access_token;
  const isForm   = opts.body instanceof FormData;

  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> ?? {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  return fetch(url, { ...opts, headers });
}

/** Parse JSON from response, throw a readable Error if not OK. */
export async function jsonOrThrow<T>(res: Response): Promise<T> {
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body?.error as string) ?? `Request failed (${res.status})`);
  return body as T;
}
