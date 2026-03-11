import { admin } from './supabaseAdmin';

export async function notify(
  userId: string,
  type: string,
  title: string,
  body: string,
  link?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await admin.from('notifications').insert({
      user_id:  userId,
      type,
      title,
      body,
      link:     link     ?? null,
      metadata: metadata ?? null,
    });
  } catch (e) {
    // Notifications are best-effort — never crash the main flow
    console.error('[notify] failed:', type, userId, e);
  }
}
