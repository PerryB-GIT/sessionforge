import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('DELETE /api/user', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns 401 when not authenticated', async () => {
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
    const { DELETE } = await import('../route')
    const res = await DELETE()
    expect(res.status).toBe(401)
  })
})
