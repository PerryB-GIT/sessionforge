import { eq } from 'drizzle-orm'
import { db, ipAllowlists } from '@/db'
import { redis } from './redis'
import { isIpInCidr } from './ip-cidr-utils'

export { isIpInCidr } from './ip-cidr-utils'

const CACHE_TTL_SECONDS = 60

/**
 * Returns true if the given IP is allowed for the org.
 * If the org has no allowlist entries, all IPs are allowed (empty = open).
 * Results are cached in Redis for 60 seconds.
 */
export async function checkIpAllowlist(orgId: string, ip: string): Promise<boolean> {
  try {
    const cacheKey = `ip-allowlist:${orgId}`

    let cidrs: string[] | null = null
    const cached = await redis.get(cacheKey)
    if (cached !== null) {
      try {
        cidrs = JSON.parse(cached as string) as string[]
        if (!Array.isArray(cidrs)) cidrs = null // reset on invalid cache value
      } catch {
        cidrs = null // invalid JSON — fall through to DB query
      }
    }

    if (cidrs === null) {
      const entries = await db
        .select({ cidr: ipAllowlists.cidr })
        .from(ipAllowlists)
        .where(eq(ipAllowlists.orgId, orgId))
      cidrs = entries.map((e) => e.cidr)
      await redis.set(cacheKey, JSON.stringify(cidrs), { ex: CACHE_TTL_SECONDS })
    }

    if (cidrs.length === 0) return true
    return cidrs.some((cidr) => isIpInCidr(ip, cidr))
  } catch (err) {
    console.error('[ip-allowlist] checkIpAllowlist error:', err)
    return true // fail open — never block users due to allowlist service errors
  }
}

export async function invalidateAllowlistCache(orgId: string): Promise<void> {
  await redis.del(`ip-allowlist:${orgId}`)
}
