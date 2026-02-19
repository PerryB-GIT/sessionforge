/**
 * Unit tests for API key utilities
 *
 * Tests the three core functions:
 *   - generateApiKey()   – creates a new raw key
 *   - hashApiKey(key)    – produces a deterministic SHA-256 hash for storage
 *   - validateApiKey(key, db) – looks up a key and checks expiry
 *
 * STUB: The actual implementations are imported from the backend module once
 * the Backend agent builds them.  The import lines below are marked as stubs
 * and will be uncommented when the module is available.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as crypto from 'crypto'

// STUB: import when backend builds [api-keys module]
// import { generateApiKey, hashApiKey, validateApiKey, PlanLimitError } from '@sessionforge/backend/lib/api-keys'

// ---------------------------------------------------------------------------
// Inline stubs — replace with real imports once backend is built
// ---------------------------------------------------------------------------

/** Prefix used by the app for all live API keys */
const API_KEY_PREFIX = 'sf_live_'

function generateApiKey(): string {
  const random = crypto.randomBytes(24).toString('hex') // 48 hex chars
  return `${API_KEY_PREFIX}${random}`
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

class ApiKeyError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'ApiKeyError'
  }
}

interface MockDbRow {
  id: string
  userId: string
  keyHash: string
  keyPrefix: string
  expiresAt: Date | null
  scopes: string
}

async function validateApiKey(
  key: string,
  dbLookup: (hash: string) => Promise<MockDbRow | null>
): Promise<{ userId: string; scopes: string[] }> {
  if (!key.startsWith(API_KEY_PREFIX)) {
    throw new ApiKeyError('Invalid API key format', 'INVALID_FORMAT')
  }
  const hash = hashApiKey(key)
  const row = await dbLookup(hash)
  if (!row) throw new ApiKeyError('API key not found', 'NOT_FOUND')
  if (row.expiresAt && row.expiresAt < new Date()) {
    throw new ApiKeyError('API key has expired', 'EXPIRED')
  }
  return { userId: row.userId, scopes: row.scopes.split(',') }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateApiKey', () => {
  it('returns a string starting with sf_live_', () => {
    const key = generateApiKey()
    expect(key).toMatch(/^sf_live_/)
  })

  it('returns a key of consistent length', () => {
    const key = generateApiKey()
    // sf_live_ (8) + 48 hex chars = 56 chars
    expect(key.length).toBe(56)
  })

  it('generates unique keys on each call', () => {
    const keys = Array.from({ length: 20 }, () => generateApiKey())
    const unique = new Set(keys)
    expect(unique.size).toBe(20)
  })

  it('key prefix (first 8 chars after sf_live_) is stored for display', () => {
    const key = generateApiKey()
    // The prefix stored in the DB is the first 8 chars of the random part
    const randomPart = key.slice(API_KEY_PREFIX.length)
    const keyPrefix = randomPart.slice(0, 8)
    expect(keyPrefix).toHaveLength(8)
    expect(keyPrefix).toMatch(/^[0-9a-f]+$/)
  })
})

describe('hashApiKey', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const key = generateApiKey()
    const hash = hashApiKey(key)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces the same hash for the same key (deterministic)', () => {
    const key = generateApiKey()
    expect(hashApiKey(key)).toBe(hashApiKey(key))
  })

  it('produces different hashes for different keys', () => {
    const key1 = generateApiKey()
    const key2 = generateApiKey()
    expect(hashApiKey(key1)).not.toBe(hashApiKey(key2))
  })

  it('hash is not reversible (preimage resistance)', () => {
    const key = generateApiKey()
    const hash = hashApiKey(key)
    // The original key should NOT appear in the hash output
    expect(hash).not.toContain(key.replace(API_KEY_PREFIX, ''))
  })
})

describe('validateApiKey', () => {
  const userId = 'user-uuid-123'

  function makeRow(overrides: Partial<MockDbRow> = {}): MockDbRow {
    const key = generateApiKey()
    return {
      id: 'key-uuid-456',
      userId,
      keyHash: hashApiKey(key),
      keyPrefix: key.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8),
      expiresAt: null,
      scopes: 'agent',
      ...overrides,
    }
  }

  it('returns userId and scopes for a valid, non-expired key', async () => {
    const key = generateApiKey()
    const row = makeRow({ keyHash: hashApiKey(key), expiresAt: null, scopes: 'agent,read' })
    const dbLookup = vi.fn().mockResolvedValue(row)

    const result = await validateApiKey(key, dbLookup)
    expect(result.userId).toBe(userId)
    expect(result.scopes).toContain('agent')
    expect(result.scopes).toContain('read')
  })

  it('throws for a key with an invalid format (no sf_live_ prefix)', async () => {
    const dbLookup = vi.fn()
    await expect(validateApiKey('invalid_key_format', dbLookup)).rejects.toThrow(ApiKeyError)
    expect(dbLookup).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the key hash does not exist in the DB', async () => {
    const key = generateApiKey()
    const dbLookup = vi.fn().mockResolvedValue(null)
    await expect(validateApiKey(key, dbLookup)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws EXPIRED when the key has a past expiresAt date', async () => {
    const key = generateApiKey()
    const expiredRow = makeRow({
      keyHash: hashApiKey(key),
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    })
    const dbLookup = vi.fn().mockResolvedValue(expiredRow)
    await expect(validateApiKey(key, dbLookup)).rejects.toMatchObject({ code: 'EXPIRED' })
  })

  it('accepts a key whose expiresAt is in the future', async () => {
    const key = generateApiKey()
    const futureRow = makeRow({
      keyHash: hashApiKey(key),
      expiresAt: new Date(Date.now() + 60_000), // 1 minute in the future
    })
    const dbLookup = vi.fn().mockResolvedValue(futureRow)
    await expect(validateApiKey(key, dbLookup)).resolves.toMatchObject({ userId })
  })

  it('accepts a key with no expiry (expiresAt is null)', async () => {
    const key = generateApiKey()
    const noExpiryRow = makeRow({ keyHash: hashApiKey(key), expiresAt: null })
    const dbLookup = vi.fn().mockResolvedValue(noExpiryRow)
    await expect(validateApiKey(key, dbLookup)).resolves.toMatchObject({ userId })
  })
})
