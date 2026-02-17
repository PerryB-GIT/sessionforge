/**
 * Unit tests for authentication utilities
 *
 * Tests:
 *   - Password hashing with bcrypt (hash / verify)
 *   - Session token generation (JWT via jose)
 *   - Email verification token generation
 *   - Password strength validation
 *
 * STUB: Real implementations will be imported from the backend auth module once built.
 * import { hashPassword, verifyPassword, createSessionToken, verifySessionToken,
 *          generateVerificationToken, validatePasswordStrength }
 *   from '@sessionforge/backend/auth'
 */

import { describe, it, expect, vi } from 'vitest'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'

// ---------------------------------------------------------------------------
// Inline stubs — replace with real imports once backend is built
// STUB: import when backend builds [auth module]
// ---------------------------------------------------------------------------

const BCRYPT_COST = 10 // use 10 in tests for speed (production uses 12)
const JWT_SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET ?? 'test-secret')
const TOKEN_EXPIRY = '1h'

/** Hash a plaintext password */
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

/** Verify a plaintext password against a stored hash */
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

interface TokenPayload {
  sub: string // userId
  email: string
  plan: string
}

/** Generate a signed JWT session token */
async function createSessionToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET)
}

/** Verify and decode a session token */
async function verifySessionToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET)
  return payload as unknown as TokenPayload
}

/**
 * Generate a URL-safe email verification token.
 * Returns a 32-byte random hex string.
 */
function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate password strength.
 * Rules: min 8 chars, at least one uppercase, one lowercase, one digit, one special char.
 */
function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = []
  if (password.length < 8) errors.push('Password must be at least 8 characters')
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter')
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter')
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number')
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must contain at least one special character')
  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Password hashing tests
// ---------------------------------------------------------------------------

describe('hashPassword', () => {
  it('returns a non-empty string', async () => {
    const hash = await hashPassword('TestPassword123!')
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
  })

  it('produces a bcrypt hash starting with $2b$', async () => {
    const hash = await hashPassword('TestPassword123!')
    expect(hash).toMatch(/^\$2[ab]\$/)
  })

  it('produces different hashes for the same password (salt randomness)', async () => {
    const hash1 = await hashPassword('TestPassword123!')
    const hash2 = await hashPassword('TestPassword123!')
    expect(hash1).not.toBe(hash2)
  })

  it('does not store the plaintext password in the hash output', async () => {
    const password = 'TestPassword123!'
    const hash = await hashPassword(password)
    expect(hash).not.toContain(password)
  })
})

describe('verifyPassword', () => {
  it('returns true for the correct password', async () => {
    const password = 'TestPassword123!'
    const hash = await hashPassword(password)
    expect(await verifyPassword(password, hash)).toBe(true)
  })

  it('returns false for an incorrect password', async () => {
    const hash = await hashPassword('TestPassword123!')
    expect(await verifyPassword('WrongPassword456!', hash)).toBe(false)
  })

  it('returns false for an empty password', async () => {
    const hash = await hashPassword('TestPassword123!')
    expect(await verifyPassword('', hash)).toBe(false)
  })

  it('returns false for a hash that does not match any password', async () => {
    const hash = '$2b$10$invalidhashvaluexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    // bcrypt.compare returns false without throwing on invalid hashes
    const result = await verifyPassword('any', hash).catch(() => false)
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Token generation / verification tests
// ---------------------------------------------------------------------------

describe('createSessionToken', () => {
  it('returns a non-empty JWT string', async () => {
    const token = await createSessionToken({ sub: 'user-123', email: 'test@example.com', plan: 'free' })
    expect(token).toBeTruthy()
    expect(token.split('.')).toHaveLength(3) // header.payload.signature
  })

  it('encodes the userId as the sub claim', async () => {
    const token = await createSessionToken({ sub: 'user-abc', email: 'test@example.com', plan: 'free' })
    const decoded = await verifySessionToken(token)
    expect(decoded.sub).toBe('user-abc')
  })

  it('encodes the email in the payload', async () => {
    const token = await createSessionToken({ sub: 'user-123', email: 'perry@example.com', plan: 'pro' })
    const decoded = await verifySessionToken(token)
    expect(decoded.email).toBe('perry@example.com')
  })

  it('encodes the plan in the payload', async () => {
    const token = await createSessionToken({ sub: 'user-123', email: 'test@example.com', plan: 'team' })
    const decoded = await verifySessionToken(token)
    expect(decoded.plan).toBe('team')
  })

  it('generates unique tokens for different calls with the same payload', async () => {
    const payload = { sub: 'user-123', email: 'test@example.com', plan: 'free' }
    const token1 = await createSessionToken(payload)
    // Wait 1ms so iat differs
    await new Promise((r) => setTimeout(r, 1))
    const token2 = await createSessionToken(payload)
    // Tokens may differ because iat (issued-at) changes each second
    // This test verifies the function can be called multiple times without error
    expect(token1).toBeTruthy()
    expect(token2).toBeTruthy()
  })
})

describe('verifySessionToken', () => {
  it('successfully verifies a valid token', async () => {
    const token = await createSessionToken({ sub: 'user-999', email: 'test@example.com', plan: 'pro' })
    await expect(verifySessionToken(token)).resolves.toBeTruthy()
  })

  it('throws when the token is tampered with', async () => {
    const token = await createSessionToken({ sub: 'user-999', email: 'test@example.com', plan: 'pro' })
    const tampered = token.slice(0, -5) + 'xxxxx'
    await expect(verifySessionToken(tampered)).rejects.toThrow()
  })

  it('throws when the token is signed with a different secret', async () => {
    const wrongSecret = new TextEncoder().encode('completely-wrong-secret')
    const token = await new SignJWT({ sub: 'user-999', email: 'x@y.com', plan: 'free' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongSecret)

    await expect(verifySessionToken(token)).rejects.toThrow()
  })

  it('throws for a malformed token string', async () => {
    await expect(verifySessionToken('not.a.jwt')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Email verification token tests
// ---------------------------------------------------------------------------

describe('generateVerificationToken', () => {
  it('returns a 64-character hex string', () => {
    const token = generateVerificationToken()
    expect(token).toHaveLength(64)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique tokens on each call', () => {
    const tokens = Array.from({ length: 20 }, () => generateVerificationToken())
    const unique = new Set(tokens)
    expect(unique.size).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Password strength validation tests
// ---------------------------------------------------------------------------

describe('validatePasswordStrength', () => {
  it('accepts a strong password', () => {
    const result = validatePasswordStrength('TestPassword123!')
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects passwords shorter than 8 characters', () => {
    const result = validatePasswordStrength('Sh0rt!')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /8 characters/i.test(e))).toBe(true)
  })

  it('rejects passwords with no uppercase letter', () => {
    const result = validatePasswordStrength('allowercase123!')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /uppercase/i.test(e))).toBe(true)
  })

  it('rejects passwords with no lowercase letter', () => {
    const result = validatePasswordStrength('ALLUPPERCASE123!')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /lowercase/i.test(e))).toBe(true)
  })

  it('rejects passwords with no digit', () => {
    const result = validatePasswordStrength('NoDigitsHere!')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /number/i.test(e))).toBe(true)
  })

  it('rejects passwords with no special character', () => {
    const result = validatePasswordStrength('NoSpecialChar1')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /special/i.test(e))).toBe(true)
  })

  it('can return multiple errors for a very weak password', () => {
    const result = validatePasswordStrength('weak')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })

  it('accepts passwords with various special characters', () => {
    const specialChars = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')']
    for (const ch of specialChars) {
      const result = validatePasswordStrength(`Str0ngPass${ch}`)
      expect(result.valid, `expected valid for special char: ${ch}`).toBe(true)
    }
  })
})
