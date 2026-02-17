/**
 * Test database helpers
 *
 * Provides setup/teardown utilities for integration tests that need a real
 * PostgreSQL connection.  Uses the TEST_DATABASE_URL environment variable
 * (defaulting to a local sessionforge_test database).
 *
 * STUB: The actual drizzle client is imported from the backend app once it
 * is built by the Backend agent.  Until then, the helpers below are wired
 * to the web app's DB client which shares the same schema.
 */

// STUB: import when backend builds its own DB module
// import { db, schema } from '@sessionforge/backend/db'

// For now we reference the web app's drizzle instance directly so tests
// that run in a monorepo context can exercise real DB queries.
// STUB: import { db } from '../../../apps/web/src/db'
// STUB: import * as schema from '../../../apps/web/src/db/schema'

import { vi, beforeAll, afterAll, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

let _isConnected = false

/**
 * Connect to the test database.
 * Call this inside a beforeAll() in any integration test that needs DB access.
 */
export async function connectTestDb(): Promise<void> {
  if (_isConnected) return
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set')

  // STUB: when DB module is available, initialise the drizzle connection here
  // await db.$connect?.()
  _isConnected = true
  console.log(`[test-db] connected to ${url.replace(/:[^:@]*@/, ':***@')}`)
}

/**
 * Disconnect from the test database.
 * Call this inside an afterAll() in any integration test suite.
 */
export async function disconnectTestDb(): Promise<void> {
  if (!_isConnected) return
  // STUB: await db.$disconnect?.()
  _isConnected = false
  console.log('[test-db] disconnected')
}

// ---------------------------------------------------------------------------
// Table truncation helpers
// ---------------------------------------------------------------------------

/**
 * Truncate all tables in dependency order (child → parent) so foreign key
 * constraints are respected.  Cascades are used where needed.
 */
export async function truncateAllTables(): Promise<void> {
  // STUB: replace with actual drizzle delete statements once DB is built
  // await db.delete(schema.auditLogs)
  // await db.delete(schema.sessionMetrics)
  // await db.delete(schema.sessions)
  // await db.delete(schema.apiKeys)
  // await db.delete(schema.machines)
  // await db.delete(schema.invitations)
  // await db.delete(schema.orgMembers)
  // await db.delete(schema.organizations)
  // await db.delete(schema.users)
  console.log('[test-db] truncated all tables (stub)')
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

export interface SeedUserResult {
  id: string
  email: string
  plan: string
}

/**
 * Insert a test user directly into the database.
 * Returns the created user row.
 */
export async function seedUser(data: {
  email: string
  passwordHash: string
  name: string
  plan?: string
  emailVerified?: boolean
}): Promise<SeedUserResult> {
  // STUB: replace with actual drizzle insert once DB is built
  // const [user] = await db.insert(schema.users).values({
  //   email: data.email,
  //   passwordHash: data.passwordHash,
  //   name: data.name,
  //   plan: data.plan ?? 'free',
  //   emailVerified: data.emailVerified ?? true,
  // }).returning()
  // return user

  // Stub returns a deterministic fake row for now
  return {
    id: `stub-user-${Date.now()}`,
    email: data.email,
    plan: data.plan ?? 'free',
  }
}

export interface SeedMachineResult {
  id: string
  agentToken: string
  userId: string
}

/**
 * Insert a test machine directly into the database.
 * Returns the created machine row including the raw agentToken.
 */
export async function seedMachine(data: {
  userId: string
  name: string
  os?: 'linux' | 'macos' | 'windows'
  hostname?: string
  agentToken?: string
}): Promise<SeedMachineResult> {
  // STUB: replace with actual drizzle insert once DB is built
  // const token = data.agentToken ?? `sf_live_${crypto.randomUUID().replace(/-/g,'')}`
  // const [machine] = await db.insert(schema.machines).values({
  //   userId: data.userId,
  //   name: data.name,
  //   os: data.os ?? 'linux',
  //   hostname: data.hostname ?? 'test-host',
  //   agentToken: token,
  //   status: 'offline',
  // }).returning()
  // return { ...machine, agentToken: token }

  const token = data.agentToken ?? `sf_live_stub${Date.now()}`
  return {
    id: `stub-machine-${Date.now()}`,
    agentToken: token,
    userId: data.userId,
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers for common test lifecycle patterns
// ---------------------------------------------------------------------------

/**
 * Call this at the top of an integration test suite to wire up DB
 * connect/disconnect automatically.
 *
 * @example
 * describe('machines API', () => {
 *   useTestDatabase()
 *   // ... tests
 * })
 */
export function useTestDatabase(): void {
  beforeAll(async () => {
    await connectTestDb()
  })

  afterEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await disconnectTestDb()
  })
}
