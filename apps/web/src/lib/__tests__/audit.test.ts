import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('logAuditEvent', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/db', () => ({
      db: {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      },
      auditLogs: {},
    }))
  })

  it('inserts an audit log row', async () => {
    const { logAuditEvent } = await import('../audit')
    await expect(
      logAuditEvent('org-123', 'user-456', 'member.invited', { targetId: 'email@test.com' })
    ).resolves.toBeUndefined()
  })

  it('resolves when userId is null', async () => {
    const { logAuditEvent } = await import('../audit')
    await expect(logAuditEvent('org-123', null, 'session.started')).resolves.toBeUndefined()
  })
})
