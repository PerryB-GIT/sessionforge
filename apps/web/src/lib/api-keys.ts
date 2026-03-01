import { createHash, randomBytes } from 'crypto'
import { eq, and, isNull, gt, or } from 'drizzle-orm'
import { db, apiKeys } from '@/db'

const KEY_PREFIX = 'sf_live_'
const PREFIX_DISPLAY_LENGTH = 8 // characters shown after sf_live_ in UI

export interface GeneratedApiKey {
  key: string    // full key (only returned once)
  hash: string   // SHA-256 to store in DB
  prefix: string // first 8 chars after sf_live_ for display
}

/**
 * Generates a new API key with the sf_live_ prefix.
 * The full key is returned exactly once - only the hash is stored.
 */
export function generateApiKey(): GeneratedApiKey {
  const randomPart = randomBytes(24).toString('base64url') // 32 URL-safe chars
  const key = `${KEY_PREFIX}${randomPart}`
  const hash = hashApiKey(key)
  const prefix = randomPart.slice(0, PREFIX_DISPLAY_LENGTH)

  return { key, hash, prefix }
}

/**
 * SHA-256 hash of the full API key for storage.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export interface ValidatedApiKey {
  id: string
  userId: string
  orgId: string | null
  scopes: string[]
  name: string
}

/**
 * Validates an API key by hash lookup, checks expiry, and updates lastUsedAt.
 * Returns null if the key is invalid, expired, or not found.
 */
export async function validateApiKey(key: string): Promise<ValidatedApiKey | null> {
  if (!key.startsWith(KEY_PREFIX)) return null

  const hash = hashApiKey(key)
  const now = new Date()

  const [record] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      orgId: apiKeys.orgId,
      scopes: apiKeys.scopes,
      name: apiKeys.name,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash))
    .limit(1)

  if (!record) return null

  // Check expiry
  if (record.expiresAt && record.expiresAt < now) return null

  // Update lastUsedAt asynchronously (don't await to avoid adding latency)
  db.update(apiKeys)
    .set({ lastUsedAt: now })
    .where(eq(apiKeys.id, record.id))
    .catch((err) => console.error('[api-keys] failed to update lastUsedAt:', err))

  return {
    id: record.id,
    userId: record.userId,
    orgId: record.orgId,
    scopes: record.scopes,
    name: record.name,
  }
}
