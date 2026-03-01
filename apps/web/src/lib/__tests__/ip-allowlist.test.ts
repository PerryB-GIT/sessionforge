import { describe, it, expect } from 'vitest'

describe('isIpInCidr', () => {
  it('matches an IP within a CIDR range', async () => {
    const { isIpInCidr } = await import('../ip-allowlist')
    expect(isIpInCidr('192.168.1.50', '192.168.1.0/24')).toBe(true)
  })

  it('rejects an IP outside the CIDR range', async () => {
    const { isIpInCidr } = await import('../ip-allowlist')
    expect(isIpInCidr('10.0.0.1', '192.168.1.0/24')).toBe(false)
  })

  it('matches an exact IP /32', async () => {
    const { isIpInCidr } = await import('../ip-allowlist')
    expect(isIpInCidr('10.0.0.5', '10.0.0.5/32')).toBe(true)
  })

  it('returns false for invalid CIDR', async () => {
    const { isIpInCidr } = await import('../ip-allowlist')
    expect(isIpInCidr('10.0.0.1', 'not-a-cidr')).toBe(false)
  })
})
