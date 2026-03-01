import { describe, it, expect } from 'vitest'

describe('notifications schema', () => {
  it('exports notifications table', async () => {
    const schema = await import('@/db/schema')
    expect(schema.notifications).toBeDefined()
    expect(schema.notifications).toHaveProperty('id')
  })
})
