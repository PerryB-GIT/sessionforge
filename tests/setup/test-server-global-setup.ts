/**
 * Vitest globalSetup — starts the Next.js dev server on port 3099 before the
 * integration test suite runs, then tears it down afterwards.
 *
 * The BASE_URL env var is set to http://localhost:3099 so every test file can
 * do:  const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3099'
 *
 * Why next dev rather than next start?
 *   next start requires a prior `next build` which is slow in CI.
 *   next dev works out of the box from the source tree and respects the same
 *   env vars, making it suitable for integration tests against real route
 *   handlers.
 *
 * Port 3099 is used to avoid conflicts with Docker/WSL which occupies 3001.
 *
 * Ports:
 *   3099 — Next.js HTTP (integration tests hit this via fetch)
 *
 * Environment variables consumed by the route handlers are set in
 * tests/setup/vitest.setup.ts; the child process inherits process.env so
 * those values flow into the Next.js server automatically.
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process'
import * as path from 'path'

const TEST_PORT = 3099
export const TEST_BASE_URL = `http://localhost:${TEST_PORT}`

// Absolute path to the Next.js app
const WEB_APP_DIR = path.resolve(__dirname, '../../../../apps/web')

// ─── Testcontainers PostgreSQL ─────────────────────────────────────────────
// Start a real PostgreSQL container before the Next.js server so DATABASE_URL
// is available when the server child process is spawned.

let _pgContainer: import('@testcontainers/postgresql').StartedPostgreSqlContainer | null = null

async function startPostgresContainer(): Promise<string> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
  const postgres = await import('postgres')

  _pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('sessionforge_test')
    .withUsername('test')
    .withPassword('test')
    .start()

  const connectionUri = _pgContainer.getConnectionUri()

  // Create schema so the app server can run migrations/queries immediately
  const sql = (postgres.default ?? postgres)(connectionUri, { max: 2 })
  await sql.unsafe(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    DO $$ BEGIN CREATE TYPE plan AS ENUM ('free','pro','team','enterprise'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE member_role AS ENUM ('owner','admin','member','viewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE machine_os AS ENUM ('windows','macos','linux'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE machine_status AS ENUM ('online','offline','error'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE session_status AS ENUM ('running','stopped','crashed','paused'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE TYPE support_ticket_status AS ENUM ('pending','approved','rejected','closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(255) NOT NULL UNIQUE, password_hash TEXT, name VARCHAR(255), plan plan NOT NULL DEFAULT 'free', stripe_customer_id VARCHAR(255), email_verified TIMESTAMPTZ, onboarding_completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255) NOT NULL, slug VARCHAR(255) NOT NULL UNIQUE, owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, plan plan NOT NULL DEFAULT 'free', stripe_subscription_id VARCHAR(255), stripe_customer_id VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS org_members (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, role member_role NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS org_invites (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, email VARCHAR(255) NOT NULL, token VARCHAR(64) NOT NULL UNIQUE, role member_role NOT NULL DEFAULT 'member', invited_by UUID REFERENCES users(id) ON DELETE SET NULL, expires_at TIMESTAMPTZ NOT NULL, accepted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (org_id, email));
    CREATE TABLE IF NOT EXISTS machines (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, org_id UUID REFERENCES organizations(id) ON DELETE SET NULL, name VARCHAR(255) NOT NULL, os machine_os NOT NULL, hostname VARCHAR(255) NOT NULL, agent_version VARCHAR(64) NOT NULL DEFAULT '0.0.0', status machine_status NOT NULL DEFAULT 'offline', last_seen TIMESTAMPTZ, ip_address VARCHAR(45), cpu_model VARCHAR(255), ram_gb REAL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, pid INTEGER, process_name VARCHAR(255) NOT NULL DEFAULT 'claude', workdir TEXT, status session_status NOT NULL DEFAULT 'running', exit_code INTEGER, peak_memory_mb REAL, avg_cpu_percent REAL, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), stopped_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS api_keys (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, org_id UUID REFERENCES organizations(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, key_hash VARCHAR(64) NOT NULL UNIQUE, key_prefix VARCHAR(8) NOT NULL, scopes TEXT[] NOT NULL DEFAULT '{}', last_used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS accounts (user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, provider TEXT NOT NULL, provider_account_id TEXT NOT NULL, refresh_token TEXT, access_token TEXT, expires_at INTEGER, token_type TEXT, scope TEXT, id_token TEXT, session_state TEXT, UNIQUE (provider, provider_account_id));
    CREATE TABLE IF NOT EXISTS verification_tokens (identifier TEXT NOT NULL, token TEXT NOT NULL, expires TIMESTAMPTZ NOT NULL, UNIQUE (identifier, token));
    CREATE TABLE IF NOT EXISTS sessions_auth (session_token VARCHAR(255) NOT NULL UNIQUE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS password_reset_tokens (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, token VARCHAR(255) NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS support_tickets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, machine_id UUID REFERENCES machines(id) ON DELETE SET NULL, subject VARCHAR(255) NOT NULL, message TEXT NOT NULL, agent_logs TEXT, browser_logs TEXT, ai_draft TEXT, approval_token VARCHAR(255) UNIQUE, status support_ticket_status NOT NULL DEFAULT 'pending', approved_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `)
  await sql.end()

  console.log(`[test-db] Postgres container started → ${connectionUri.replace(/:[^:@]*@/, ':***@')}`)
  return connectionUri
}

async function stopPostgresContainer(): Promise<void> {
  if (_pgContainer) {
    await _pgContainer.stop()
    _pgContainer = null
    console.log('[test-db] Postgres container stopped')
  }
}

let serverProcess: ChildProcess | null = null

/** Poll until the /api/health endpoint responds (any HTTP status), or throw after timeout. */
async function waitForServer(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (including 503 when DB is not yet injected) means
      // the Next.js process is alive and accepting connections.
      await fetch(`${url}/api/health`)
      return
    } catch {
      // Server not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`[test-server] Timed out waiting for Next.js server at ${url}`)
}

export async function setup(): Promise<void> {
  // Step 1: Start Postgres container and get the connection URL.
  // This MUST happen before spawning Next.js so DATABASE_URL is available
  // in the child process environment.
  const dbUrl = await startPostgresContainer()
  process.env.DATABASE_URL = dbUrl
  process.env.TEST_DATABASE_URL = dbUrl

  // If the server is already running (e.g., in watch mode), skip starting it
  try {
    const res = await fetch(`${TEST_BASE_URL}/api/health`)
    if (res.status < 500) {
      console.log(`[test-server] Server already running at ${TEST_BASE_URL}`)
      process.env.TEST_BASE_URL = TEST_BASE_URL
      return
    }
  } catch {
    // Not running — fall through to spawn
  }

  // Free the port if a previous test run left a zombie process (Windows only).
  // spawnSync with fixed args — no user input involved, no injection risk.
  if (process.platform === 'win32') {
    const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8' })
    const pids = [...new Set(
      (netstat.stdout ?? '').split('\n')
        .filter(l => l.includes(`:${TEST_PORT} `) && l.includes('LISTENING'))
        .map(l => l.trim().split(/\s+/).pop())
        .filter((p): p is string => Boolean(p) && /^\d+$/.test(p ?? ''))
    )]
    for (const pid of pids) {
      spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' })
    }
    if (pids.length) {
      console.log(`[test-server] Freed port ${TEST_PORT} (killed PIDs: ${pids.join(', ')})`)
      await new Promise(r => setTimeout(r, 1500))
    }
  }

  console.log(`[test-server] Starting Next.js dev server on port ${TEST_PORT}…`)
  console.log(`[test-server] Working directory: ${WEB_APP_DIR}`)

  // Inherit env so vitest.setup.ts env vars (mocks, secrets) reach the server
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: dbUrl,
    PORT: String(TEST_PORT),
    NODE_ENV: 'test',
    NEXTAUTH_SECRET: 'test-secret-do-not-use-in-production',
    NEXTAUTH_URL: `http://localhost:${TEST_PORT}`,
    RESEND_API_KEY: 're_test_vitest_mock',
    UPSTASH_REDIS_REST_URL: '',   // disable Redis rate limiting in tests
    UPSTASH_REDIS_REST_TOKEN: '',
    // Disable telemetry noise
    NEXT_TELEMETRY_DISABLED: '1',
  }

  serverProcess = spawn('npx', ['next', 'dev', '--port', String(TEST_PORT)], {
    cwd: WEB_APP_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim()
    if (line) process.stdout.write(`[next-dev] ${line}\n`)
  })

  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim()
    if (line) process.stderr.write(`[next-dev] ${line}\n`)
  })

  serverProcess.on('error', (err) => {
    console.error('[test-server] Failed to start Next.js process:', err)
  })

  process.env.TEST_BASE_URL = TEST_BASE_URL

  await waitForServer(TEST_BASE_URL, 90_000)
  console.log(`[test-server] Next.js server is ready at ${TEST_BASE_URL}`)
}

export async function teardown(): Promise<void> {
  if (serverProcess) {
    console.log('[test-server] Stopping Next.js dev server…')
    serverProcess.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      serverProcess!.once('exit', () => resolve())
      // Force-kill after 10s if it doesn't exit cleanly
      setTimeout(() => {
        serverProcess?.kill('SIGKILL')
        resolve()
      }, 10_000)
    })
    serverProcess = null
    console.log('[test-server] Server stopped.')
  }

  await stopPostgresContainer()
}
