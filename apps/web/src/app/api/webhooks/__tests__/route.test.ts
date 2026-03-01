import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('POST /api/webhooks', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['session.started'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 for free plan user', async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
    }))
    vi.doMock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ plan: 'free' }]),
            }),
          }),
        }),
      },
      users: {},
      webhooks: {},
    }))
    vi.doMock('@sessionforge/shared-types', () => ({
      isFeatureAvailable: vi.fn().mockReturnValue(false),
      ApiResponse: {},
      ApiError: {},
    }))
    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['session.started'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/webhooks/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
    const { DELETE } = await import('../[id]/route')
    const req = new Request('http://localhost/api/webhooks/123', { method: 'DELETE' })
    const res = await DELETE(req as any, { params: { id: '123' } })
    expect(res.status).toBe(401)
  })
})
