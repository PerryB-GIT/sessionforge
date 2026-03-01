import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('requireOrgRole', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws 401 when session is null', async () => {
    vi.doMock('@/db', () => ({
      db: { select: vi.fn() },
      orgMembers: {},
    }))
    const { requireOrgRole } = await import('../org-auth')
    await expect(requireOrgRole(null, 'org-1', 'member')).rejects.toMatchObject({
      status: 401,
    })
  })

  it('throws 403 when user is not an org member', async () => {
    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      },
      orgMembers: {},
    }))
    const { requireOrgRole } = await import('../org-auth')
    const session = { user: { id: 'user-1' } }
    await expect(requireOrgRole(session as any, 'org-1', 'member')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('throws 403 when user role is below minRole', async () => {
    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ role: 'viewer' }]),
            }),
          }),
        }),
      },
      orgMembers: {},
    }))
    const { requireOrgRole } = await import('../org-auth')
    const session = { user: { id: 'user-1' } }
    await expect(requireOrgRole(session as any, 'org-1', 'admin')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('returns the role when user has sufficient role', async () => {
    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ role: 'admin' }]),
            }),
          }),
        }),
      },
      orgMembers: {},
    }))
    const { requireOrgRole } = await import('../org-auth')
    const session = { user: { id: 'user-1' } }
    const role = await requireOrgRole(session as any, 'org-1', 'member')
    expect(role).toBe('admin')
  })
})
