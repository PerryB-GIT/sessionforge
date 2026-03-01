import { db, auditLogs } from '@/db'

export type AuditAction =
  | 'member.invited'
  | 'member.removed'
  | 'session.started'
  | 'session.stopped'
  | 'machine.added'
  | 'machine.deleted'
  | 'sso.login'
  | 'sso.fallback'
  | 'api_key.created'
  | 'api_key.deleted'
  | 'plan.changed'
  | 'ip_allowlist.updated'

export async function logAuditEvent(
  orgId: string,
  userId: string | null,
  action: AuditAction,
  options?: {
    targetId?: string
    metadata?: Record<string, unknown>
    ip?: string
  }
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      orgId,
      userId: userId ?? undefined,
      action,
      targetId: options?.targetId,
      metadata: options?.metadata,
      ip: options?.ip,
    })
  } catch (err) {
    console.error('[audit] failed to write audit log:', err)
  }
}
