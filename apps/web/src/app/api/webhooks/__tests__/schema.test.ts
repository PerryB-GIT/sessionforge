import { describe, it, expect } from 'vitest'

describe('webhooks schema', () => {
  it('exports webhooks and webhookDeliveries tables', async () => {
    const schema = await import('@/db/schema')
    expect(schema.webhooks).toBeDefined()
    expect(schema.webhookDeliveries).toBeDefined()
  })
})
