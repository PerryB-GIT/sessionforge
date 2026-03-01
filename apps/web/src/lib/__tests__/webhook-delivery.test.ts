import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('signWebhookPayload', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('produces a sha256 HMAC signature', async () => {
    const { signWebhookPayload } = await import('../webhook-delivery')
    const sig = await signWebhookPayload('my-secret', '{"event":"test"}')
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('produces different signatures for different secrets', async () => {
    const { signWebhookPayload } = await import('../webhook-delivery')
    const sig1 = await signWebhookPayload('secret-a', '{"event":"test"}')
    const sig2 = await signWebhookPayload('secret-b', '{"event":"test"}')
    expect(sig1).not.toBe(sig2)
  })

  it('produces different signatures for different payloads', async () => {
    const { signWebhookPayload } = await import('../webhook-delivery')
    const sig1 = await signWebhookPayload('secret', '{"event":"test1"}')
    const sig2 = await signWebhookPayload('secret', '{"event":"test2"}')
    expect(sig1).not.toBe(sig2)
  })
})

describe('generateWebhookSecret', () => {
  it('generates a 64-char hex string', async () => {
    const { generateWebhookSecret } = await import('../webhook-delivery')
    const secret = generateWebhookSecret()
    expect(secret).toMatch(/^[a-f0-9]{64}$/)
  })

  it('generates unique secrets each call', async () => {
    const { generateWebhookSecret } = await import('../webhook-delivery')
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret())
  })
})
