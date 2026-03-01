/**
 * Test database helpers
 *
 * Spins up a real PostgreSQL container via @testcontainers/postgresql for
 * integration tests.  The container is a singleton — all describe blocks in a
 * process share one container, which is started once and torn down once.
 *
 * Because the web app has no Drizzle migration files yet the schema is
 * created with raw SQL that mirrors apps/web/src/db/schema/index.ts.
 *
 * Usage:
 *
 *   describe('my integration suite', () => {
 *     useTestDatabase()          // wires beforeAll / afterEach / afterAll
 *     // ...
 *   })
 */

import { beforeAll, afterAll, afterEach } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Singleton container + drizzle client
// ---------------------------------------------------------------------------

let _container: StartedPostgreSqlContainer | null = null
let _sql: ReturnType<typeof postgres> | null = null
let _db: ReturnType<typeof drizzle> | null = null

/**
 * Returns the active drizzle/postgres client.
 * Throws if `useTestDatabase()` has not been called yet.
 */
export function getTestDb(): ReturnType<typeof drizzle> {
  if (!_db) throw new Error('[test-db] No active test database. Did you call useTestDatabase()?')
  return _db
}

/**
 * Returns the active raw postgres client (postgres-js sql tag).
 * Useful for raw queries outside of drizzle.
 */
export function getTestSql(): ReturnType<typeof postgres> {
  if (!_sql) throw new Error('[test-db] No active test database. Did you call useTestDatabase()?')
  return _sql
}

// ---------------------------------------------------------------------------
// Schema DDL — mirrors apps/web/src/db/schema/index.ts
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  DO $$ BEGIN
    CREATE TYPE plan AS ENUM ('free', 'pro', 'team', 'enterprise');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  DO $$ BEGIN
    CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member', 'viewer');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  DO $$ BEGIN
    CREATE TYPE machine_os AS ENUM ('windows', 'macos', 'linux');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  DO $$ BEGIN
    CREATE TYPE machine_status AS ENUM ('online', 'offline', 'error');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('running', 'stopped', 'crashed', 'paused');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  DO $$ BEGIN
    CREATE TYPE support_ticket_status AS ENUM ('pending', 'approved', 'rejected', 'closed');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   TEXT,
    name            VARCHAR(255),
    plan            plan NOT NULL DEFAULT 'free',
    stripe_customer_id VARCHAR(255),
    email_verified  TIMESTAMPTZ,
    onboarding_completed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan            plan NOT NULL DEFAULT 'free',
    stripe_subscription_id VARCHAR(255),
    stripe_customer_id     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS org_members (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      member_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS machines (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id        UUID REFERENCES organizations(id) ON DELETE SET NULL,
    name          VARCHAR(255) NOT NULL,
    os            machine_os NOT NULL,
    hostname      VARCHAR(255) NOT NULL,
    agent_version VARCHAR(64) NOT NULL DEFAULT '0.0.0',
    status        machine_status NOT NULL DEFAULT 'offline',
    last_seen     TIMESTAMPTZ,
    ip_address    VARCHAR(45),
    cpu_model     VARCHAR(255),
    ram_gb        REAL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id   UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pid          INTEGER,
    process_name VARCHAR(255) NOT NULL DEFAULT 'claude',
    workdir      TEXT,
    status       session_status NOT NULL DEFAULT 'running',
    exit_code    INTEGER,
    peak_memory_mb  REAL,
    avg_cpu_percent REAL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name       VARCHAR(255) NOT NULL,
    key_hash   VARCHAR(64) NOT NULL UNIQUE,
    key_prefix VARCHAR(8) NOT NULL,
    scopes     TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS accounts (
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                 TEXT NOT NULL,
    provider             TEXT NOT NULL,
    provider_account_id  TEXT NOT NULL,
    refresh_token        TEXT,
    access_token         TEXT,
    expires_at           INTEGER,
    token_type           TEXT,
    scope                TEXT,
    id_token             TEXT,
    session_state        TEXT,
    UNIQUE (provider, provider_account_id)
  );

  CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier TEXT NOT NULL,
    token      TEXT NOT NULL,
    expires    TIMESTAMPTZ NOT NULL,
    UNIQUE (identifier, token)
  );

  CREATE TABLE IF NOT EXISTS sessions_auth (
    session_token VARCHAR(255) NOT NULL UNIQUE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires       TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS org_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       VARCHAR(255) NOT NULL,
    token       VARCHAR(64) NOT NULL UNIQUE,
    role        member_role NOT NULL DEFAULT 'member',
    invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, email)
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    machine_id      UUID REFERENCES machines(id) ON DELETE SET NULL,
    subject         VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    agent_logs      TEXT,
    browser_logs    TEXT,
    ai_draft        TEXT,
    approval_token  VARCHAR(255) UNIQUE,
    status          support_ticket_status NOT NULL DEFAULT 'pending',
    approved_at     TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

async function startContainer(): Promise<void> {
  if (_container) return

  _container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('sessionforge_test')
    .withUsername('test')
    .withPassword('test')
    .start()

  const connectionUri = _container.getConnectionUri()

  _sql = postgres(connectionUri, { max: 5 })
  _db = drizzle(_sql)

  // Create schema via raw SQL (no migration files exist yet)
  await _sql.unsafe(SCHEMA_SQL)

  console.log(`[test-db] container started → ${connectionUri.replace(/:[^:@]*@/, ':***@')}`)
}

async function stopContainer(): Promise<void> {
  if (_sql) {
    await _sql.end()
    _sql = null
  }
  if (_container) {
    await _container.stop()
    _container = null
  }
  _db = null
  console.log('[test-db] container stopped')
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/**
 * Truncate all tables in dependency order (child → parent).
 * CASCADE handles any remaining FK references.
 */
export async function clearTable(tableName: string): Promise<void> {
  const sql = getTestSql()
  await sql.unsafe(`TRUNCATE TABLE ${tableName} CASCADE`)
}

async function truncateAllTables(): Promise<void> {
  const sql = getTestSql()
  await sql.unsafe(`
    TRUNCATE TABLE
      support_tickets,
      sessions,
      api_keys,
      accounts,
      verification_tokens,
      sessions_auth,
      password_reset_tokens,
      org_invites,
      org_members,
      machines,
      organizations,
      users
    CASCADE
  `)
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

export interface SeedUserResult {
  id: string
  email: string
  name: string | null
  plan: string
}

/**
 * Insert a test user directly into the database and return the created row.
 */
export async function seedUser(data: {
  email: string
  passwordHash: string
  name: string
  plan?: string
  emailVerified?: boolean
}): Promise<SeedUserResult> {
  const sql = getTestSql()
  const plan = data.plan ?? 'free'
  const emailVerifiedValue = data.emailVerified !== false ? 'NOW()' : 'NULL'

  const rows = await sql.unsafe<SeedUserResult[]>(`
    INSERT INTO users (email, password_hash, name, plan, email_verified)
    VALUES ($1, $2, $3, $4::plan, ${emailVerifiedValue})
    RETURNING id, email, name, plan
  `, [data.email, data.passwordHash, data.name, plan])

  return rows[0]
}

export interface SeedMachineResult {
  id: string
  userId: string
  name: string
}

/**
 * Insert a test machine directly into the database and return the created row.
 */
export async function seedMachine(data: {
  userId: string
  name: string
  os?: 'linux' | 'macos' | 'windows'
  hostname?: string
}): Promise<SeedMachineResult> {
  const sql = getTestSql()
  const os = data.os ?? 'linux'
  const hostname = data.hostname ?? `test-host-${crypto.randomUUID().slice(0, 8)}`

  const rows = await sql.unsafe<SeedMachineResult[]>(`
    INSERT INTO machines (user_id, name, os, hostname)
    VALUES ($1, $2, $3::machine_os, $4)
    RETURNING id, user_id AS "userId", name
  `, [data.userId, data.name, os, hostname])

  return rows[0]
}

// ---------------------------------------------------------------------------
// useTestDatabase — convenience lifecycle hook for vitest describe blocks
// ---------------------------------------------------------------------------

/**
 * Wire up a real PostgreSQL container for the enclosing describe block.
 *
 * @example
 * describe('auth API', () => {
 *   useTestDatabase()
 *   // ... tests
 * })
 */
export function useTestDatabase(): void {
  beforeAll(async () => {
    await startContainer()
  }, 120_000 /* containers can take up to 2 min on cold pull */)

  afterEach(async () => {
    await truncateAllTables()
  })

  afterAll(async () => {
    await stopContainer()
  })
}
