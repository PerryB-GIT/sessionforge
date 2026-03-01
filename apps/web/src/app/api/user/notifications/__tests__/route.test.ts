import { describe, it, expect, vi, beforeEach } from 'vitest'

const DEFAULT_PREFS = {
  sessionCrashed: true,
  machineOffline: true,
  sessionStarted: false,
  weeklyDigest: true,
}

// Shared db mock factory — returns a chain that resolves to the provided rows
function makeDbMock(rows: unknown[]) {
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    },
    users: {},
  }
}

describe('GET /api/user/notifications', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
    vi.doMock('@/db', () => makeDbMock([]))
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns defaults when notificationPreferences is null', async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
    }))
    vi.doMock('@/db', () => makeDbMock([{ notificationPreferences: null }]))
    const { GET } = await import('../route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toEqual(DEFAULT_PREFS)
  })
})

describe('PATCH /api/user/notifications', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns 400 for invalid body', async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
    }))
    vi.doMock('@/db', () => makeDbMock([]))
    const { PATCH } = await import('../route')
    const req = new Request('http://localhost/api/user/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ sessionCrashed: 'not-a-boolean' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req as any)
    expect(res.status).toBe(400)
  })
})
