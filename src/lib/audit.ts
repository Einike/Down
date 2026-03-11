import { admin } from './supabaseAdmin';

export async function auditLog(
  userId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await admin.from('audit_log').insert({
      user_id:     userId,
      action,
      entity_type: entityType ?? null,
      entity_id:   entityId   ?? null,
      metadata:    metadata   ?? null,
    });
  } catch (e) {
    console.error('[audit] failed:', action, e);
  }
}
