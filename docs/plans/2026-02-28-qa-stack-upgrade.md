# QA Stack Upgrade — Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a world-class, proactive QA system for support-forge.com and sessionforge.dev that catches bugs before users do — covering auth, API contracts, WebSocket, billing, UX flows, visual regression, performance, security, chaos, and observability.

**Architecture:** Three-day tiered blitz organized by risk. Day 1 unblocks all existing `test.skip()` stubs by adding real DB seeding and email inbox integration. Day 2 replaces stub HTTP clients with real integration tests and adds WebSocket/billing/chaos coverage. Day 3 adds user-journey-first UX flows, visual regression, performance baselines, security sweeps, and the pre-deploy `qa-runbook` gate. Skills are saved to `~/.claude/skills/` and existing skills are upgraded in-place.

**Tech Stack:** Playwright, Vitest, Testcontainers (PostgreSQL), Mailosaur (email E2E), Stripe Test Clocks, ToxiProxy (chaos), Percy (visual regression), k6 + Lighthouse CI (performance), Nuclei + axe-core (security/a11y), OpenTelemetry + Sentry (observability), Checkly (synthetic monitoring), Pact (contract testing), Stryker JS (mutation), Currents (flaky test detection)

---

## Philosophy: Proactive, Not Reactive

Every skill and test in this plan is written from the **user's perspective**, not the code's perspective. The question is always: "What would a frustrated user experience right now that we don't know about?" Synthetic monitoring, chaos tests, and UX flows exist to answer that question before a user does.

---

## DAY 1 — Auth + Seed (Unblock Everything)

---

### Task 1: Install Mailosaur and configure test email inbox

**Files:**
- Modify: `sessionforge/.worktrees/agent-qa/package.json`
- Create: `sessionforge/.worktrees/agent-qa/tests/helpers/email.ts`
- Create: `sessionforge/.worktrees/agent-qa/.env.test.example`

**Context:** Every auth E2E test is currently `test.skip()` because there's no way to receive verification emails in tests. Mailosaur provides API-accessible email inboxes. Sign up at mailosaur.com (free trial), get your API key and server ID.

**Step 1: Install Mailosaur**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npm install mailosaur --save-dev
```

Expected: mailosaur added to package.json devDependencies.

**Step 2: Create .env.test.example**

Create `sessionforge/.worktrees/agent-qa/.env.test.example`:
```
MAILOSAUR_API_KEY=your_api_key_here
MAILOSAUR_SERVER_ID=your_server_id_here
PLAYWRIGHT_BASE_URL=http://localhost:3000
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sessionforge_test
```

**Step 3: Create email helper**

Create `sessionforge/.worktrees/agent-qa/tests/helpers/email.ts`:
```typescript
import MailosaurClient from 'mailosaur'

const client = new MailosaurClient(process.env.MAILOSAUR_API_KEY!)
const serverId = process.env.MAILOSAUR_SERVER_ID!

/**
 * Generate a unique test email address that routes to your Mailosaur inbox.
 * Format: anything@{serverId}.mailosaur.net
 */
export function testEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}@${serverId}.mailosaur.net`
}

/**
 * Wait for an email to arrive and return the first link found in the body.
 * Throws if no email arrives within 30 seconds.
 */
export async function getVerificationLink(email: string): Promise<string> {
  const message = await client.messages.get(serverId, {
    sentTo: email,
    timeout: 30000,
  })
  const link = message.html?.links?.[0]?.href ?? message.text?.links?.[0]?.href
  if (!link) throw new Error(`No link found in email to ${email}`)
  return link
}

/**
 * Wait for a password reset email and return the reset link.
 */
export async function getPasswordResetLink(email: string): Promise<string> {
  const message = await client.messages.get(serverId, {
    sentTo: email,
    subject: 'Reset',
    timeout: 30000,
  })
  const link = message.html?.links?.[0]?.href ?? message.text?.links?.[0]?.href
  if (!link) throw new Error(`No reset link found in email to ${email}`)
  return link
}

/**
 * Delete all messages in the server inbox. Call in beforeEach for clean state.
 */
export async function clearInbox(): Promise<void> {
  await client.messages.deleteAll(serverId)
}
```

**Step 4: Verify Mailosaur API key works**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
node -e "
const { default: Mailosaur } = require('mailosaur');
const c = new Mailosaur(process.env.MAILOSAUR_API_KEY);
c.servers.get(process.env.MAILOSAUR_SERVER_ID).then(s => console.log('OK:', s.name)).catch(e => console.error('FAIL:', e.message));
"
```

Expected: `OK: your-server-name`

**Step 5: Commit**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
git add package.json tests/helpers/email.ts .env.test.example
git commit -m "test: add Mailosaur email helper for auth E2E tests"
```

---

### Task 2: Install Testcontainers and create DB seed manager

**Files:**
- Modify: `sessionforge/.worktrees/agent-qa/package.json`
- Create: `sessionforge/.worktrees/agent-qa/tests/helpers/db.ts`
- Create: `sessionforge/.worktrees/agent-qa/tests/fixtures/users.ts`

**Context:** Integration tests use a fake in-memory stub. Testcontainers spins up a real PostgreSQL instance per test run, giving every test identical, isolated DB state. This unblocks the real supertest integration layer.

**Step 1: Install Testcontainers**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npm install @testcontainers/postgresql testcontainers --save-dev
```

**Step 2: Create DB helper**

Create `sessionforge/.worktrees/agent-qa/tests/helpers/db.ts`:
```typescript
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

let container: StartedPostgreSqlContainer | null = null
let pool: Pool | null = null

/**
 * Start a fresh PostgreSQL container and run migrations.
 * Call once in global setup (vitest.setup.ts or globalSetup).
 */
export async function startTestDatabase(): Promise<string> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('sessionforge_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start()

  const connectionString = container.getConnectionUri()
  pool = new Pool({ connectionString })

  // Run migrations against the fresh DB
  const db = drizzle(pool)
  await migrate(db, { migrationsFolder: '../../apps/web/drizzle' })

  process.env.TEST_DATABASE_URL = connectionString
  return connectionString
}

/**
 * Stop the container. Call in global teardown.
 */
export async function stopTestDatabase(): Promise<void> {
  await pool?.end()
  await container?.stop()
}

/**
 * Truncate all user-data tables between tests for isolation.
 */
export async function resetDatabase(): Promise<void> {
  if (!pool) throw new Error('Database not started')
  await pool.query(`
    TRUNCATE TABLE sessions, machines, api_keys, users
    RESTART IDENTITY CASCADE
  `)
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database not started. Call startTestDatabase() first.')
  return pool
}
```

**Step 3: Create user fixture factory**

Create `sessionforge/.worktrees/agent-qa/tests/fixtures/users.ts`:
```typescript
import { Pool } from 'pg'
import { getPool } from '../helpers/db'
import * as bcrypt from 'bcryptjs'

export interface TestUser {
  id: string
  email: string
  password: string
  name: string
  emailVerified: boolean
  plan: 'free' | 'pro'
}

/**
 * Seed a verified user directly into the DB.
 * Returns the plain-text password so tests can use it.
 */
export async function seedUser(overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const pool = getPool()
  const user: TestUser = {
    id: crypto.randomUUID(),
    email: `test-${Date.now()}@sessionforge.dev`,
    password: 'TestPass123!',
    name: 'Test User',
    emailVerified: true,
    plan: 'free',
    ...overrides,
  }

  const passwordHash = await bcrypt.hash(user.password, 10)

  await pool.query(
    `INSERT INTO users (id, email, password_hash, name, email_verified, plan, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [user.id, user.email, passwordHash, user.name, user.emailVerified, user.plan]
  )

  return user
}

/**
 * Seed a machine belonging to a user.
 */
export async function seedMachine(userId: string, name = 'Test Machine'): Promise<string> {
  const pool = getPool()
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO machines (id, user_id, name, status, created_at)
     VALUES ($1, $2, $3, 'online', NOW())`,
    [id, userId, name]
  )
  return id
}
```

**Step 4: Update vitest setup to use real DB**

Modify `sessionforge/.worktrees/agent-qa/tests/setup/vitest.setup.ts`:
```typescript
import { startTestDatabase, stopTestDatabase, resetDatabase } from '../helpers/db'

// Global setup — runs once before all tests
beforeAll(async () => {
  await startTestDatabase()
}, 60000) // 60s timeout for container pull

// Reset between tests for isolation
beforeEach(async () => {
  await resetDatabase()
})

// Teardown — runs once after all tests
afterAll(async () => {
  await stopTestDatabase()
})
```

**Step 5: Run unit tests to verify setup doesn't break anything**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npx vitest run tests/unit/ --reporter=verbose
```

Expected: All existing unit tests still pass.

**Step 6: Commit**

```bash
git add package.json tests/helpers/db.ts tests/fixtures/users.ts tests/setup/vitest.setup.ts
git commit -m "test: add Testcontainers DB seeding infrastructure"
```

---

### Task 3: Unblock auth E2E tests — email verification flow

**Files:**
- Modify: `sessionforge/.worktrees/agent-qa/tests/e2e/auth.spec.ts`

**Context:** The signup → verify email → dashboard flow is the #1 user path. It's currently `test.skip()`. We replace the skip with a real Mailosaur-backed flow.

**Step 1: Update the email verification test**

In `tests/e2e/auth.spec.ts`, replace the STUB email verification test (lines ~127-144) with:

```typescript
import { testEmail, getVerificationLink, clearInbox } from '../helpers/email'

test.beforeEach(async () => {
  await clearInbox()
})

test('email verification → redirected to dashboard', async ({ page }) => {
  const email = testEmail('verify')

  await test.step('Sign up with Mailosaur email', async () => {
    await page.goto(`${BASE_URL}/signup`)
    await fillSignupForm(page, email)
    await page.getByRole('button', { name: /sign up|create account|get started/i }).click()
    await expect(page).toHaveURL(/verify-email/, { timeout: 10000 })
  })

  await test.step('Get verification link from real inbox', async () => {
    const link = await getVerificationLink(email)
    expect(link).toContain('/verify-email')
  })

  await test.step('Navigate to link and land on dashboard', async () => {
    const link = await getVerificationLink(email)
    await page.goto(link)
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 })
    await expect(page.getByText(/welcome|machines|sessions/i)).toBeVisible()
  })
})
```

**Step 2: Unblock the login with seeded user test**

Replace the login STUB test with:
```typescript
import { seedUser } from '../fixtures/users'

test('login with valid credentials → redirected to dashboard', async ({ page }) => {
  const user = await seedUser({ emailVerified: true })

  await test.step('Navigate to login page', async () => {
    await page.goto(`${BASE_URL}/login`)
  })

  await test.step('Fill and submit login form', async () => {
    await fillLoginForm(page, user.email, user.password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
  })

  await test.step('Verify redirect to dashboard', async () => {
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 })
    await expect(page.getByText(/welcome|machines|sessions/i)).toBeVisible()
  })
})
```

**Step 3: Run the auth E2E suite**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npx playwright test tests/e2e/auth.spec.ts --reporter=line
```

Expected: Email verification and login tests now PASS (not skipped).

**Step 4: Commit**

```bash
git add tests/e2e/auth.spec.ts
git commit -m "test: unblock auth E2E — real email verification + seeded login"
```

---

### Task 4: Build qa-auth-validator skill

**Files:**
- Create: `~/.claude/skills/qa-auth-validator/SKILL.md`

**Step 1: Create the skill**

Create `C:/Users/Jakeb/.claude/skills/qa-auth-validator/SKILL.md`:
```markdown
---
name: qa-auth-validator
description: Tests all auth flows for SessionForge and Support Forge — email/password, GitHub OAuth, Google OAuth. Uses Mailosaur for real email verification and MSW for OAuth mocking. Run before every production deploy.
version: 1.0.0
---

# QA Auth Validator

You are a QA engineer specializing in authentication flows. Your job is to validate every auth path works correctly from a real user's perspective — not just that the code runs, but that a confused first-time user can actually get into the app.

## Pre-Flight Checklist

Before running any auth tests:
- [ ] Dev server running: `npm run dev` in `apps/web/`
- [ ] Test DB available: `TEST_DATABASE_URL` set in `.env.test`
- [ ] Mailosaur credentials set: `MAILOSAUR_API_KEY` and `MAILOSAUR_SERVER_ID`
- [ ] Run: `npx playwright test tests/e2e/auth.spec.ts --reporter=line`

## Auth Flows to Validate

### 1. Email/Password (Primary)
- Happy path: signup → verify email → dashboard ✓
- Weak password shows inline error (not page reload) ✓
- Duplicate email shows error (not 500) ✓
- Wrong password shows generic error (not "user not found" — security) ✓
- Unregistered email shows same error as wrong password (no user enumeration) ✓
- Forgot password → email received → reset link → new password works ✓
- Expired reset link shows clear error message ✓

### 2. GitHub OAuth
- Add `?provider=github` to test URL
- MSW intercepts OAuth redirect, returns mock user
- Verify session cookie is set with HttpOnly + Secure + SameSite=Strict
- Verify user is created in DB on first login
- Verify existing user is signed in (not duplicated) on repeat login

### 3. Google OAuth
- Same as GitHub pattern with `?provider=google`

### 4. Edge Cases (User-Perspective)
- What happens when user closes browser mid-verification? (token still valid)
- What happens when user clicks verify link twice? (graceful, not 500)
- What happens when unverified user tries to access dashboard? (redirect to verify page, not login)
- What happens when session expires? (redirect to login with "session expired" message)

## Running OAuth Tests Locally

OAuth providers block automated redirects. Use MSW to intercept:

```bash
cd .worktrees/agent-qa
MSW_ENABLED=true npx playwright test tests/e2e/auth-oauth.spec.ts
```

## Security Checks (Run These Every Time)

```bash
# Check session cookie flags
curl -I https://staging.sessionforge.dev/api/auth/session

# Should see:
# Set-Cookie: next-auth.session-token=...; HttpOnly; Secure; SameSite=Strict; Path=/

# Check auth headers
curl -I https://staging.sessionforge.dev/dashboard
# Should redirect to /login (not 200)
```

## Common Auth Bugs to Watch For

1. **Email enumeration**: "No account found" vs "Invalid credentials" — must be same message
2. **Session fixation**: Session ID must change after login
3. **Unverified access**: Unverified users must not reach dashboard
4. **CSRF on logout**: Logout must be POST, not GET (GET-based logout is CSRF-vulnerable)
5. **Token leakage**: Verification tokens must not appear in URLs after use
```

**Step 2: Verify skill is loadable**

```bash
cat "C:/Users/Jakeb/.claude/skills/qa-auth-validator/SKILL.md" | head -5
```

Expected: Skill header lines print.

**Step 3: Commit**

```bash
cd C:/Users/Jakeb/sessionforge
git add docs/
git commit -m "docs: add qa-auth-validator skill"
```

---

## DAY 2 — API + WebSocket + Billing + Chaos

---

### Task 5: Replace stub HTTP client with real supertest integration

**Files:**
- Modify: `sessionforge/.worktrees/agent-qa/tests/integration/sessions.test.ts`
- Modify: `sessionforge/.worktrees/agent-qa/tests/integration/machines.test.ts`
- Modify: `sessionforge/.worktrees/agent-qa/package.json`

**Context:** The current integration tests use a fake in-memory `stubRequest()` function. This means real DB bugs, middleware bugs, and auth bugs are invisible. We replace it with supertest hitting the actual Next.js API routes.

**Step 1: Install supertest**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npm install supertest @types/supertest --save-dev
```

**Step 2: Create API test helper**

Create `sessionforge/.worktrees/agent-qa/tests/helpers/api.ts`:
```typescript
import request from 'supertest'
import { seedUser } from '../fixtures/users'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

/**
 * Get a real session cookie by logging in a seeded user.
 * Returns headers object ready to attach to supertest requests.
 */
export async function getAuthHeaders(plan: 'free' | 'pro' = 'free'): Promise<Record<string, string>> {
  const user = await seedUser({ plan, emailVerified: true })

  const res = await request(BASE_URL)
    .post('/api/auth/callback/credentials')
    .send({ email: user.email, password: user.password })

  const cookie = res.headers['set-cookie']?.[0]
  if (!cookie) throw new Error('Login failed — no session cookie returned')

  return { Cookie: cookie }
}

/**
 * Convenience wrapper: authenticated GET request
 */
export async function authedGet(path: string) {
  const headers = await getAuthHeaders()
  return request(BASE_URL).get(path).set(headers)
}

/**
 * Convenience wrapper: authenticated POST request
 */
export async function authedPost(path: string, body: Record<string, unknown>) {
  const headers = await getAuthHeaders()
  return request(BASE_URL).post(path).set(headers).send(body)
}
```

**Step 3: Update sessions integration test to use real API**

Replace the top of `tests/integration/sessions.test.ts` (the stubRequest section) with:

```typescript
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { startTestDatabase, stopTestDatabase, resetDatabase } from '../helpers/db'
import { seedUser, seedMachine } from '../fixtures/users'
import { getAuthHeaders } from '../helpers/api'
import request from 'supertest'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

beforeAll(async () => { await startTestDatabase() }, 60000)
afterAll(async () => { await stopTestDatabase() })
beforeEach(async () => { await resetDatabase() })

// All test bodies remain the same — just replace stubRequest() calls:
// OLD: stubRequest('GET', '/api/sessions', authHeaders).send()
// NEW: request(BASE_URL).get('/api/sessions').set(authHeaders)
```

**Step 4: Run updated integration tests**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npx vitest run tests/integration/sessions.test.ts --reporter=verbose
```

Expected: Tests run against real API. Any failures indicate real bugs in the backend — investigate and fix before continuing.

**Step 5: Commit**

```bash
git add package.json tests/helpers/api.ts tests/integration/sessions.test.ts tests/integration/machines.test.ts
git commit -m "test: replace stub HTTP client with real supertest integration"
```

---

### Task 6: Build qa-websocket skill + WebSocket tests

**Files:**
- Create: `sessionforge/.worktrees/agent-qa/tests/integration/websocket-chaos.test.ts`
- Create: `~/.claude/skills/qa-websocket/SKILL.md`

**Context:** The Go agent connects to the Next.js backend via WebSocket. This is a critical path — if the WS drops, users lose visibility into their sessions. ToxiProxy simulates network conditions.

**Step 1: Install ToxiProxy client**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npm install toxiproxy-node-client --save-dev
```

**Step 2: Create WebSocket chaos test**

Create `sessionforge/.worktrees/agent-qa/tests/integration/websocket-chaos.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import Toxiproxy from 'toxiproxy-node-client'

const WS_URL = process.env.WS_URL ?? 'ws://localhost:3000/api/ws'
const toxiproxy = new Toxiproxy('http://localhost:8474')

describe('WebSocket — connection lifecycle', () => {
  it('agent can connect and receive welcome message', async () => {
    const ws = new WebSocket(WS_URL)
    const message = await new Promise<string>((resolve, reject) => {
      ws.on('message', (data) => resolve(data.toString()))
      ws.on('error', reject)
      setTimeout(() => reject(new Error('No message within 5s')), 5000)
    })
    ws.close()
    expect(JSON.parse(message)).toMatchObject({ type: 'connected' })
  })

  it('agent reconnects automatically after connection drop', async () => {
    // Create ToxiProxy proxy in front of WS server
    const proxy = await toxiproxy.createProxy({
      name: 'ws-test',
      listen: '0.0.0.0:3001',
      upstream: 'localhost:3000',
    })

    let reconnectCount = 0
    const ws = new WebSocket('ws://localhost:3001/api/ws')
    ws.on('open', () => reconnectCount++)

    // Let it connect, then cut the connection
    await new Promise(r => setTimeout(r, 500))
    await proxy.addToxic({ type: 'reset_peer', name: 'drop', stream: 'downstream', toxicity: 1, attributes: {} })

    // Wait for reconnect
    await new Promise(r => setTimeout(r, 3000))
    expect(reconnectCount).toBeGreaterThan(1)

    ws.close()
    await proxy.remove()
  })

  it('handles high latency without dropping messages', async () => {
    const proxy = await toxiproxy.createProxy({
      name: 'ws-latency',
      listen: '0.0.0.0:3002',
      upstream: 'localhost:3000',
    })

    await proxy.addToxic({
      type: 'latency',
      name: 'slow',
      stream: 'downstream',
      toxicity: 1,
      attributes: { latency: 2000, jitter: 500 },
    })

    const ws = new WebSocket('ws://localhost:3002/api/ws')
    const received: string[] = []

    ws.on('message', (data) => received.push(data.toString()))

    // Send 5 messages through the slow proxy
    await new Promise(r => ws.on('open', r))
    for (let i = 0; i < 5; i++) {
      ws.send(JSON.stringify({ type: 'ping', seq: i }))
    }

    await new Promise(r => setTimeout(r, 15000)) // Wait for all with latency
    ws.close()
    await proxy.remove()

    expect(received.length).toBe(5) // No messages lost
  })
})
```

**Step 3: Create qa-websocket skill**

Create `C:/Users/Jakeb/.claude/skills/qa-websocket/SKILL.md`:
```markdown
---
name: qa-websocket
description: Tests the Go agent ↔ Next.js backend WebSocket connection for SessionForge. Covers connection lifecycle, reconnection, concurrent sessions, and chaos scenarios using ToxiProxy.
version: 1.0.0
---

# QA WebSocket Validator

## Prerequisites

```bash
# Start ToxiProxy (Docker)
docker run -d -p 8474:8474 -p 3001:3001 -p 3002:3002 shopify/toxiproxy

# Start dev server
cd apps/web && npm run dev

# Run tests
cd .worktrees/agent-qa
npx vitest run tests/integration/websocket-chaos.test.ts --reporter=verbose
```

## Scenarios to Test

1. **Happy path**: Agent connects, receives welcome, sends heartbeat, receives ack
2. **Reconnection**: Connection drops → agent reconnects within 5 seconds
3. **High latency**: 2000ms latency → all messages eventually delivered
4. **Concurrent sessions**: 10 agents connected simultaneously, messages isolated per agent
5. **Auth failure**: Invalid API key → WS rejected with 401 (not silent drop)
6. **Bandwidth throttle**: 10kbps limit → session status updates still flow

## ToxiProxy Quick Reference

```bash
# List active proxies
curl http://localhost:8474/proxies

# Add latency toxic
curl -X POST http://localhost:8474/proxies/ws-test/toxics \
  -d '{"type":"latency","attributes":{"latency":2000}}'

# Remove all toxics (restore normal)
curl -X DELETE http://localhost:8474/proxies/ws-test/toxics/slow

# Simulate connection reset
curl -X POST http://localhost:8474/proxies/ws-test/toxics \
  -d '{"type":"reset_peer","attributes":{}}'
```

## Common WebSocket Bugs

1. **Silent drops**: WS closes without error event → agent thinks it's connected
2. **Message ordering**: Messages arrive out of order under load
3. **Auth bypass**: WS endpoint accessible without valid API key
4. **Memory leak**: Each connection leaks event listeners → server OOM over time
5. **Reconnect storm**: All agents reconnect simultaneously after server restart → thundering herd
```

**Step 4: Run WebSocket tests**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npx vitest run tests/integration/websocket-chaos.test.ts --reporter=verbose
```

Expected: Connection lifecycle tests pass. Chaos tests may reveal real bugs — document them.

**Step 5: Commit**

```bash
git add package.json tests/integration/websocket-chaos.test.ts
git commit -m "test: add WebSocket lifecycle and chaos tests with ToxiProxy"
```

---

### Task 7: Build qa-billing skill + Stripe test clock tests

**Files:**
- Create: `sessionforge/.worktrees/agent-qa/tests/e2e/billing.spec.ts` (replace stubs)
- Create: `~/.claude/skills/qa-billing/SKILL.md`

**Step 1: Update billing E2E spec**

Replace `tests/e2e/billing.spec.ts` with:
```typescript
import { test, expect } from '@playwright/test'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY!, { apiVersion: '2024-11-20.acacia' })
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

test.describe('Billing — free to pro upgrade', () => {
  test('user can upgrade from free to pro using test card', async ({ page }) => {
    // Login as free user (seeded)
    await page.goto(`${BASE_URL}/dashboard/billing`)
    await expect(page.getByText(/free plan|upgrade/i)).toBeVisible()

    await page.getByRole('button', { name: /upgrade|go pro/i }).click()
    await expect(page).toHaveURL(/checkout|billing/, { timeout: 5000 })

    // Fill Stripe test card in iframe
    const cardFrame = page.frameLocator('iframe[name*="card"]').first()
    await cardFrame.getByPlaceholder(/card number/i).fill('4242424242424242')
    await cardFrame.getByPlaceholder(/MM/i).fill('12')
    await cardFrame.getByPlaceholder(/CVC/i).fill('123')

    await page.getByRole('button', { name: /subscribe|pay/i }).click()
    await expect(page.getByText(/pro plan|active/i)).toBeVisible({ timeout: 15000 })
  })

  test('subscription renewal failure shows grace period message', async ({ page }) => {
    // Create test clock to simulate time passing
    const testClock = await stripe.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
    })

    // Create customer + subscription on the test clock
    const customer = await stripe.customers.create({
      email: 'billing-test@sessionforge.dev',
      test_clock: testClock.id,
    })

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRO_PRICE_ID! }],
      default_payment_method: 'pm_card_chargeCustomerFail', // Will fail
    })

    // Advance clock to renewal date
    await stripe.testHelpers.testClocks.advance(testClock.id, {
      frozen_time: Math.floor(Date.now() / 1000) + (31 * 24 * 60 * 60), // +31 days
    })

    // Poll until clock advances
    await new Promise(r => setTimeout(r, 5000))

    // Login and verify grace period UI
    await page.goto(`${BASE_URL}/dashboard/billing`)
    await expect(
      page.getByText(/payment failed|update payment|grace period/i)
    ).toBeVisible({ timeout: 10000 })

    // Cleanup
    await stripe.testHelpers.testClocks.del(testClock.id)
  })
})
```

**Step 2: Create qa-billing skill**

Create `C:/Users/Jakeb/.claude/skills/qa-billing/SKILL.md`:
```markdown
---
name: qa-billing
description: Tests Stripe billing lifecycle for SessionForge — trial start, upgrade, renewal, payment failure, cancellation, and plan enforcement. Uses Stripe Test Clocks to simulate time-based events.
version: 1.0.0
---

# QA Billing Validator

## Stripe Test Cards Quick Reference

| Card Number | Behavior |
|---|---|
| 4242 4242 4242 4242 | Always succeeds |
| 4000 0025 0000 3155 | Requires 3D Secure auth |
| 4000 0000 0000 9995 | Always declines |
| 4000 0000 0000 0341 | Attaching fails |

## Billing Flows to Validate

1. **Free → Pro upgrade**: Card charged, plan updated, features unlocked immediately
2. **Trial expiry**: After 14 days (advance test clock), user prompted to add card
3. **Renewal success**: Card charged on renewal date, subscription continues
4. **Renewal failure**: Card declines → grace period (3 days) → downgrade to free
5. **Manual cancellation**: User cancels → access until period end → then free
6. **Webhook delivery**: All events delivered, idempotent (safe to receive twice)
7. **Plan enforcement**: Free user cannot access pro-only features (API returns 403)

## Running Tests

```bash
# Set required env vars
export STRIPE_TEST_SECRET_KEY=sk_test_...
export STRIPE_PRO_PRICE_ID=price_...
export STRIPE_WEBHOOK_SECRET=whsec_...

# Run billing E2E
npx playwright test tests/e2e/billing.spec.ts --reporter=line

# Test webhook delivery locally
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger customer.subscription.deleted
```

## Common Stripe Bugs

1. **Idempotency**: Webhook received twice → subscription cancelled twice → data corruption
2. **Currency decimals**: JPY amounts sent as cents (1000 yen sent as 100000)
3. **Price ID mismatch**: Test price ID used in production or vice versa
4. **Missing webhook events**: Subscription updated but app not notified → stale plan data
5. **Race condition**: Webhook arrives before checkout.session.completed fully processed
```

**Step 3: Run billing tests**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
STRIPE_TEST_SECRET_KEY=sk_test_... npx playwright test tests/e2e/billing.spec.ts --reporter=line
```

**Step 4: Commit**

```bash
git add tests/e2e/billing.spec.ts
git commit -m "test: add Stripe billing E2E with test clock for renewal simulation"
```

---

### Task 8: Build api-contract-checker skill

**Files:**
- Create: `sessionforge/.worktrees/agent-qa/tests/contract/api-contracts.test.ts`
- Create: `~/.claude/skills/api-contract-checker/SKILL.md`

**Step 1: Create contract test**

Create `sessionforge/.worktrees/agent-qa/tests/contract/api-contracts.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import request from 'supertest'
import { getAuthHeaders } from '../helpers/api'
import { seedUser, seedMachine } from '../fixtures/users'

// Import shared-types schemas
import type { Session, Machine, ApiKey } from '@sessionforge/shared-types'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

describe('API Contract: /api/machines', () => {
  it('GET /api/machines returns array matching Machine type', async () => {
    const user = await seedUser()
    await seedMachine(user.id)
    const headers = await getAuthHeaders()

    const res = await request(BASE_URL).get('/api/machines').set(headers)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)

    // Each item must match the Machine type shape
    for (const machine of res.body.data) {
      expect(machine).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        status: expect.stringMatching(/^(online|offline|error)$/),
        userId: expect.any(String),
      })
    }
  })
})

describe('API Contract: /api/sessions', () => {
  it('POST /api/sessions response matches Session type', async () => {
    const user = await seedUser()
    const machineId = await seedMachine(user.id)
    const headers = await getAuthHeaders()

    const res = await request(BASE_URL)
      .post('/api/sessions')
      .set(headers)
      .send({ machineId, command: 'claude', workdir: '/home/user' })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      id: expect.any(String),
      machineId: expect.any(String),
      status: 'running',
      startedAt: expect.any(String),
      stoppedAt: null,
    })
  })
})

describe('API Contract: Error shapes', () => {
  it('all 4xx errors return { error: { code, message } }', async () => {
    const endpoints = [
      { method: 'GET', path: '/api/machines/nonexistent' },
      { method: 'POST', path: '/api/sessions' }, // missing body
      { method: 'GET', path: '/api/keys/nonexistent' },
    ]

    const headers = await getAuthHeaders()

    for (const { method, path } of endpoints) {
      const res = await request(BASE_URL)[method.toLowerCase() as 'get' | 'post'](path).set(headers)
      if (res.status >= 400 && res.status < 500) {
        expect(res.body).toHaveProperty('error')
        expect(res.body.error).toHaveProperty('code')
      }
    }
  })
})
```

**Step 2: Create skill**

Create `C:/Users/Jakeb/.claude/skills/api-contract-checker/SKILL.md`:
```markdown
---
name: api-contract-checker
description: Validates live API responses against the shared-types TypeScript definitions in packages/shared-types/. Catches type drift between backend and frontend. Run on every PR that touches API routes.
version: 1.0.0
---

# API Contract Checker

Catches the bug where the backend changes a field name (`machineId` → `machine_id`) but the frontend still expects the old name — a silent type drift that only shows up as undefined at runtime.

## When to Run

- Any PR touching `apps/web/src/app/api/`
- Any PR touching `packages/shared-types/src/`
- Before every production deploy

## Run

```bash
cd .worktrees/agent-qa
npx vitest run tests/contract/ --reporter=verbose
```

## What to Check If Tests Fail

1. Did a field get renamed in the API but not in shared-types?
2. Did a field type change (string → number)?
3. Did a nullable field become required?
4. Did error response shape change?

Any of these is a contract break. The fix must update BOTH the API and shared-types in the same PR.

## Adding New Contract Tests

For every new API endpoint, add a test in `tests/contract/api-contracts.test.ts` that:
1. Makes a real request with valid auth
2. Asserts the response matches the TypeScript type shape
3. Tests the error shape for 404 and 400 cases
```

**Step 3: Run contract tests**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npx vitest run tests/contract/ --reporter=verbose
```

**Step 4: Commit**

```bash
git add tests/contract/
git commit -m "test: add API contract tests validating live responses against shared-types"
```

---

## DAY 3 — UX Flows + Visual + Performance + Security + Gate

---

### Task 9: Build qa-ux-flows skill + user journey E2E tests

**Files:**
- Create: `sessionforge/.worktrees/agent-qa/tests/e2e/onboarding.spec.ts`
- Create: `sessionforge/.worktrees/agent-qa/tests/e2e/machine-dashboard.spec.ts`
- Create: `~/.claude/skills/qa-ux-flows/SKILL.md`

**Context:** User-journey tests are written from the user's emotional perspective, not the developer's. The question is: "Can a real person, who has never used this before, accomplish this task without frustration?"

**Step 1: Create onboarding flow test**

Create `tests/e2e/onboarding.spec.ts`:
```typescript
import { test, expect } from '@playwright/test'
import { testEmail, getVerificationLink } from '../helpers/email'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

test.describe('Onboarding — first-time user journey', () => {
  test('new user can go from signup to connected machine in under 5 minutes', async ({ page }) => {
    const email = testEmail('onboard')

    // STEP 1: Discover and sign up
    await test.step('Sign up', async () => {
      await page.goto(BASE_URL)
      await page.getByRole('link', { name: /get started|sign up|try free/i }).click()
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/password/i).first().fill('OnboardPass123!')
      await page.getByLabel(/name/i).fill('New User')
      await page.getByRole('button', { name: /sign up|create account/i }).click()
      await expect(page).toHaveURL(/verify-email/)
    })

    // STEP 2: Verify email
    await test.step('Verify email from inbox', async () => {
      const link = await getVerificationLink(email)
      await page.goto(link)
      await expect(page).toHaveURL(/dashboard/)
      // Welcome state should be visible — not an empty confusing dashboard
      await expect(
        page.getByText(/welcome|get started|add your first machine|connect/i)
      ).toBeVisible()
    })

    // STEP 3: See clear next step (not a blank screen)
    await test.step('Dashboard shows clear call-to-action for new user', async () => {
      const cta = page.getByRole('button', { name: /add machine|connect agent|get started/i })
      await expect(cta).toBeVisible()
    })

    // STEP 4: Navigate to machine setup
    await test.step('Machine setup page has clear instructions', async () => {
      await page.getByRole('button', { name: /add machine|connect/i }).first().click()
      // Instructions must be visible — user should not be confused about what to do
      await expect(page.getByText(/install|download|run|agent/i)).toBeVisible()
      // Install command should be copyable
      await expect(page.getByRole('button', { name: /copy/i })).toBeVisible()
    })
  })

  test('empty state shows helpful guidance not a blank page', async ({ page }) => {
    // Login as fresh user with no machines
    await page.goto(`${BASE_URL}/login`)
    // ... fill with seeded fresh user
    await expect(page.getByText(/no machines|add your first|get started/i)).toBeVisible()
    // Must NOT show an empty list with no guidance
    await expect(page.getByText(/undefined|null|error/i)).not.toBeVisible()
  })
})
```

**Step 2: Create qa-ux-flows skill**

Create `C:/Users/Jakeb/.claude/skills/qa-ux-flows/SKILL.md`:
```markdown
---
name: qa-ux-flows
description: User-journey-first E2E tests for SessionForge and Support Forge. Written from the user's emotional perspective — can a real, confused first-time user accomplish each task without frustration? Covers onboarding, machine setup, session management, and admin flows.
version: 1.0.0
---

# QA UX Flows

## The Prime Directive

Every test must ask: "What would a frustrated first-time user experience right now?"

Not: "Does the API return 200?"
But: "Can a person who has never seen this app add their first machine without emailing support?"

## User Journeys to Cover

### New User Onboarding (Highest Priority)
1. Land on homepage → understand what SessionForge does in 10 seconds
2. Click "Get Started" → reach signup without confusion
3. Signup → receive verification email within 60 seconds
4. Verify email → see a welcoming dashboard (NOT a blank screen)
5. Dashboard → clearly understand next step (add a machine)
6. Copy install command → run on machine → machine appears in dashboard

**Success criteria**: A non-technical user can complete this in under 10 minutes.

### Returning User (Daily Active)
1. Login → dashboard loads < 2 seconds
2. See machine status at a glance (green/red, no ambiguity)
3. Click into a session → see logs/output without page reload
4. Stop a session → status updates in real time (not after refresh)

### Admin Dashboard
1. Admin can view all users
2. Admin can see billing status per user
3. Admin can manually adjust plan if needed
4. Admin actions are audited (who did what, when)

### Support Forge (support-forge.com)
1. Visitor arrives → clearly understands what Support Forge does
2. CTA leads to Calendly booking without broken redirects
3. Contact form submits successfully and Perry receives email
4. Mobile experience does not break navigation or readability

## UX Red Flags to Check Every Sprint

- [ ] Empty states have guidance, not blank screens
- [ ] Error messages are human-readable ("Payment failed" not "stripe_error: card_declined")
- [ ] Loading states are shown (no mystery freezes)
- [ ] Redirects go where they claim ("Go to dashboard" → actually dashboard)
- [ ] Mobile: touch targets >= 44px, no horizontal scroll
- [ ] Forms preserve input on validation error (don't wipe the form)
- [ ] Success states are unambiguous (don't make users wonder "did it work?")

## Run

```bash
npx playwright test tests/e2e/onboarding.spec.ts tests/e2e/session.spec.ts --reporter=line
```
```

**Step 3: Commit**

```bash
git add tests/e2e/onboarding.spec.ts tests/e2e/machine-dashboard.spec.ts
git commit -m "test: add user-journey-first onboarding and UX flow E2E tests"
```

---

### Task 10: Set up Percy visual regression

**Files:**
- Modify: `sessionforge/.worktrees/agent-qa/package.json`
- Create: `sessionforge/.worktrees/agent-qa/tests/visual/visual-regression.spec.ts`

**Step 1: Install Percy**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npm install @percy/playwright --save-dev
```

Sign up at percy.io (free: 5,000 screenshots/month). Get `PERCY_TOKEN`.

**Step 2: Create visual regression spec**

Create `tests/visual/visual-regression.spec.ts`:
```typescript
import { test } from '@playwright/test'
import percySnapshot from '@percy/playwright'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

test.describe('Visual regression — SessionForge', () => {
  test('homepage', async ({ page }) => {
    await page.goto(BASE_URL)
    await percySnapshot(page, 'Homepage')
  })

  test('login page', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await percySnapshot(page, 'Login Page')
  })

  test('signup page', async ({ page }) => {
    await page.goto(`${BASE_URL}/signup`)
    await percySnapshot(page, 'Signup Page')
  })

  test('dashboard — empty state', async ({ page }) => {
    // Login with seeded user, no machines
    await page.goto(`${BASE_URL}/dashboard`)
    await percySnapshot(page, 'Dashboard — Empty State')
  })

  test('dashboard — with machines', async ({ page }) => {
    // Login with seeded user + machines
    await page.goto(`${BASE_URL}/dashboard`)
    await percySnapshot(page, 'Dashboard — With Machines')
  })
})

test.describe('Visual regression — Support Forge', () => {
  test('homepage', async ({ page }) => {
    await page.goto('https://support-forge.com')
    await percySnapshot(page, 'Support Forge — Homepage')
  })
})
```

**Step 3: Run Percy baseline (first run establishes baseline)**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
PERCY_TOKEN=your_token npx percy exec -- npx playwright test tests/visual/
```

Expected: First run creates baseline. Future runs diff against it. Percy dashboard shows visual diffs.

**Step 4: Commit**

```bash
git add package.json tests/visual/
git commit -m "test: add Percy visual regression for SessionForge and Support Forge"
```

---

### Task 11: Build qa-security skill + security sweep

**Files:**
- Create: `sessionforge/.worktrees/agent-qa/tests/security/security-headers.test.ts`
- Create: `~/.claude/skills/qa-security/SKILL.md`

**Step 1: Create security headers test**

Create `tests/security/security-headers.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import request from 'supertest'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

describe('Security Headers', () => {
  it('sets X-Frame-Options to deny clickjacking', async () => {
    const res = await request(BASE_URL).get('/')
    expect(res.headers['x-frame-options']).toMatch(/DENY|SAMEORIGIN/)
  })

  it('sets Content-Security-Policy', async () => {
    const res = await request(BASE_URL).get('/')
    expect(res.headers['content-security-policy']).toBeDefined()
  })

  it('sets Strict-Transport-Security', async () => {
    const res = await request(BASE_URL).get('/')
    // Only present in production (HTTPS)
    if (process.env.NODE_ENV === 'production') {
      expect(res.headers['strict-transport-security']).toMatch(/max-age/)
    }
  })

  it('session cookies have HttpOnly and SameSite flags', async () => {
    const res = await request(BASE_URL).post('/api/auth/callback/credentials')
      .send({ email: 'test@test.com', password: 'wrong' })
    const cookies = res.headers['set-cookie'] ?? []
    for (const cookie of cookies) {
      if (cookie.includes('session')) {
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toMatch(/SameSite=(Strict|Lax)/)
      }
    }
  })

  it('protected routes return 401 without auth, not 404', async () => {
    const protectedRoutes = [
      '/api/machines',
      '/api/sessions',
      '/api/keys',
    ]
    for (const route of protectedRoutes) {
      const res = await request(BASE_URL).get(route)
      expect(res.status).toBe(401) // Must be 401, not 404 (which would reveal route existence)
    }
  })

  it('no IDOR — user cannot access another users machines', async () => {
    // Seed two users
    // Login as user 1, get user 2's machine ID
    // Attempt GET /api/machines/{user2MachineId} as user 1
    // Must return 404 (not 200, not 403 — 404 is correct to not reveal existence)
    // Implementation: use seedUser + seedMachine twice
  })
})
```

**Step 2: Create qa-security skill**

Create `C:/Users/Jakeb/.claude/skills/qa-security/SKILL.md`:
```markdown
---
name: qa-security
description: Security QA sweep for SessionForge and Support Forge. Covers security headers, JWT config, CORS, rate limiting, CSRF, session cookies, IDOR checks, and OWASP Top 10 validation. Run before every production deploy.
version: 1.0.0
---

# QA Security Validator

## Quick Automated Sweep

```bash
# Security header check
cd .worktrees/agent-qa
npx vitest run tests/security/ --reporter=verbose

# Nuclei scan (requires nuclei installed)
nuclei -u https://staging.sessionforge.dev -t cves/ -t misconfigurations/ -severity medium,high,critical

# ZAP baseline scan
docker run -t zaproxy/zap-stable zap-baseline.py -t https://staging.sessionforge.dev
```

## Checklist — Run Before Every Production Deploy

### Auth & Session
- [ ] Session cookies: HttpOnly, Secure, SameSite=Strict
- [ ] Session ID rotates after login (no session fixation)
- [ ] JWT: RS256 algorithm (not HS256 with weak secret)
- [ ] JWT: expiry set (not unlimited)
- [ ] Logout: POST not GET (GET logout = CSRF)

### Authorization
- [ ] All `/api/` routes return 401 (not 404) without auth
- [ ] User A cannot access User B's resources (IDOR check)
- [ ] Admin routes require admin role (not just auth)
- [ ] Stripe webhooks validate signature before processing

### Input & Output
- [ ] All user input passes through Zod validation
- [ ] No raw SQL string interpolation (use parameterized queries)
- [ ] Error messages don't leak stack traces to clients
- [ ] User email not leaked in "user not found" errors

### Headers
- [ ] X-Frame-Options: DENY
- [ ] Content-Security-Policy defined
- [ ] HSTS in production
- [ ] CORS: explicit allowlist, not wildcard `*` on authenticated routes

### Rate Limiting
- [ ] /api/auth/signin: max 5 attempts per minute per IP
- [ ] /api/auth/forgot-password: max 3 per hour
- [ ] /api/ general: 100 requests/minute per user

## OWASP Top 10 Quick Check

| Risk | Where | How to Test |
|---|---|---|
| Broken Access Control | All `/api/` routes | IDOR test with two users |
| Injection | All form inputs | Zod schema validation in code review |
| Auth failures | Login + session | Cookie flags, session rotation |
| Security misconfiguration | Headers, CORS | Nuclei scan |
| Vulnerable components | Dependencies | `npm audit` |
```

**Step 3: Run security tests**

```bash
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-qa
npx vitest run tests/security/ --reporter=verbose
```

**Step 4: Commit**

```bash
git add tests/security/
git commit -m "test: add security header and IDOR tests"
```

---

### Task 12: Set up k6 + Lighthouse CI performance baseline

**Files:**
- Create: `sessionforge/.worktrees/agent-qa/tests/performance/load.js`
- Create: `sessionforge/.worktrees/agent-qa/tests/performance/lighthouse.js`
- Create: `~/.claude/skills/qa-performance/SKILL.md`

**Step 1: Create k6 load test**

Create `tests/performance/load.js`:
```javascript
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  // Baseline: 50 concurrent users for 2 minutes
  stages: [
    { duration: '30s', target: 10 },  // Ramp up
    { duration: '1m', target: 50 },   // Hold
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // 95% of requests under 2s
    http_req_failed: ['rate<0.01'],     // Less than 1% errors
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const AUTH_COOKIE = __ENV.AUTH_COOKIE || ''

export default function () {
  // Test: unauthenticated homepage
  const homeRes = http.get(BASE_URL)
  check(homeRes, { 'homepage status 200': (r) => r.status === 200 })

  sleep(1)

  // Test: authenticated API (machines list)
  const apiRes = http.get(`${BASE_URL}/api/machines`, {
    headers: { Cookie: AUTH_COOKIE },
  })
  check(apiRes, {
    'machines API status 200': (r) => r.status === 200,
    'machines API < 500ms': (r) => r.timings.duration < 500,
  })

  sleep(1)
}
```

**Step 2: Create qa-performance skill**

Create `C:/Users/Jakeb/.claude/skills/qa-performance/SKILL.md`:
```markdown
---
name: qa-performance
description: Performance baseline testing for SessionForge and Support Forge using k6 (load testing) and Lighthouse CI (frontend performance). Establishes baselines and catches regressions before production.
version: 1.0.0
---

# QA Performance Validator

## Run Load Test

```bash
# Install k6: https://k6.io/docs/get-started/installation/
k6 run tests/performance/load.js --env BASE_URL=https://staging.sessionforge.dev

# Target: p95 < 2000ms, error rate < 1%
```

## Run Lighthouse

```bash
npx lighthouse https://staging.sessionforge.dev --output=json --output-path=./lh-report.json
npx lighthouse https://support-forge.com --output=json --output-path=./lh-sf-report.json
```

## Performance Targets

| Metric | Target | Why |
|---|---|---|
| Lighthouse Performance | >= 85 | User experience |
| Lighthouse Accessibility | >= 95 | Compliance + users |
| Time to Interactive | < 3.5s | Conversion impact |
| p95 API response | < 2000ms | Reliability |
| p99 API response | < 5000ms | Tail latency |
| Error rate under load | < 1% | Stability |
| WebSocket connect time | < 500ms | Agent UX |

## Regression Detection

If any metric drops more than 10% from baseline, block the deploy and investigate:
1. Is it a code change? (check git diff)
2. Is it a DB query change? (run EXPLAIN ANALYZE)
3. Is it infrastructure? (check Cloud Run metrics)
4. Is it a CDN/caching issue? (check CloudFlare cache hit rate)
```

**Step 3: Commit**

```bash
git add tests/performance/
git commit -m "test: add k6 load test and Lighthouse CI performance baseline"
```

---

### Task 13: Set up Checkly synthetic monitoring

**Files:**
- Create: `sessionforge/infra/checkly/checks/onboarding-smoke.check.ts`
- Create: `~/.claude/skills/qa-observability/SKILL.md`

**Context:** Checkly runs Playwright tests against production every 5 minutes. If the onboarding flow breaks at 3am, you know before users do.

**Step 1: Install Checkly CLI**

```bash
npm install --save-dev checkly
npx checkly login
```

**Step 2: Create production smoke check**

Create `sessionforge/infra/checkly/checks/onboarding-smoke.check.ts`:
```typescript
import { BrowserCheck, Frequency } from 'checkly/constructs'

new BrowserCheck('onboarding-smoke', {
  name: 'SessionForge — Onboarding smoke test',
  frequency: Frequency.EVERY_5M,
  locations: ['us-east-1', 'eu-west-1'],
  code: {
    entrypoint: './scripts/onboarding-smoke.spec.ts',
  },
  alertChannels: [], // Add Slack/email alert channel IDs here
})
```

**Step 3: Create the smoke script**

Create `sessionforge/infra/checkly/scripts/onboarding-smoke.spec.ts`:
```typescript
import { test, expect } from '@playwright/test'

// This runs every 5 minutes against production
test('SessionForge homepage loads and CTA is visible', async ({ page }) => {
  await page.goto('https://sessionforge.dev')
  await expect(page).toHaveTitle(/SessionForge/)
  await expect(page.getByRole('link', { name: /get started|sign up/i })).toBeVisible()
})

test('Login page is accessible', async ({ page }) => {
  await page.goto('https://sessionforge.dev/login')
  await expect(page.getByLabel(/email/i)).toBeVisible()
  await expect(page.getByLabel(/password/i)).toBeVisible()
})

test('Support Forge homepage loads', async ({ page }) => {
  await page.goto('https://support-forge.com')
  await expect(page).toHaveTitle(/Support Forge/)
})
```

**Step 4: Deploy checks**

```bash
npx checkly deploy
```

**Step 5: Create qa-observability skill**

Create `C:/Users/Jakeb/.claude/skills/qa-observability/SKILL.md`:
```markdown
---
name: qa-observability
description: Proactive production monitoring for SessionForge and Support Forge using Checkly synthetic monitoring, Sentry error tracking, and OpenTelemetry traces. Catches issues before users report them.
version: 1.0.0
---

# QA Observability — Proactive, Not Reactive

## The Philosophy

Reactive QA: User emails "login is broken" → you investigate → fix in 2 hours.
Proactive QA: Checkly detects login broken at 3:04am → Slack alert → you fix before first user wakes up.

## Checkly — Synthetic Monitoring

Runs real Playwright tests against production every 5 minutes.

```bash
# View current check status
npx checkly test

# Deploy updated checks
npx checkly deploy

# View recent results
npx checkly check results
```

**Checks running 24/7:**
- SessionForge homepage loads ✓
- Login page accessible ✓
- Support Forge homepage loads ✓
- (Add: Signup flow, dashboard load, API health)

## Sentry — Error Tracking

Every unhandled error in production appears in Sentry within seconds.

**Triage process:**
1. New error appears in Sentry → auto-assigned to on-call
2. Check if it's a regression (compare to last deploy)
3. If user-impacting: hotfix immediately
4. If background: file ticket, fix in next sprint

**Key alerts configured:**
- Error rate > 1% → Slack alert
- New error type → immediate notification
- Performance degradation > 20% → alert

## OpenTelemetry — Distributed Tracing

Every request traced end-to-end: browser → Next.js → PostgreSQL.

```bash
# View traces in Grafana
# http://localhost:3000/grafana (local dev)

# Key things to trace:
# - /api/auth/signin latency (should be < 500ms)
# - /api/machines query time (should be < 100ms)
# - WebSocket connection establishment (should be < 200ms)
```

## What to Monitor

| Signal | Threshold | Action |
|---|---|---|
| Error rate | > 1% | Immediate investigation |
| p95 latency | > 3s | Check DB, check deployments |
| Auth failure rate | > 5% | Check auth service, check email |
| WebSocket drops | > 2% | Check Go agent, check WS server |
| Stripe webhook failures | Any | Check Stripe dashboard |
| Checkly check failure | Any | Check production logs |
```

**Step 6: Commit**

```bash
cd C:/Users/Jakeb/sessionforge
git add infra/checkly/
git commit -m "feat: add Checkly synthetic monitoring for production proactive QA"
```

---

### Task 14: Build the qa-runbook — pre-deploy gate

**Files:**
- Create: `~/.claude/skills/qa-runbook/SKILL.md`

**Context:** This is the master gate. Nothing ships to production without passing this runbook. Every skill built in Days 1-3 is referenced here.

**Step 1: Create qa-runbook skill**

Create `C:/Users/Jakeb/.claude/skills/qa-runbook/SKILL.md`:
```markdown
---
name: qa-runbook
description: Pre-deploy quality gate for SessionForge and Support Forge. Every item must pass before any production deploy. Chains all QA skills into a single mandatory checklist.
version: 1.0.0
---

# QA Runbook — Pre-Deploy Gate

> Nothing ships to production without passing this runbook. This is not optional.

## Who runs this?

Run this skill before every deploy to production. If you're unsure whether a change is "big enough" to need this — it is. Run it.

## Step 1: Auth Validation (5 min)

```bash
cd sessionforge/.worktrees/agent-qa
npx playwright test tests/e2e/auth.spec.ts --reporter=line
```

**Must pass:** Email signup, verification, login, logout, password reset.
**If fails:** Do NOT deploy. Fix auth before anything else.

## Step 2: API Contracts (3 min)

```bash
npx vitest run tests/contract/ --reporter=verbose
```

**Must pass:** All API responses match shared-types shapes.
**If fails:** Type drift between backend and frontend. Fix and redeploy.

## Step 3: Integration Tests (5 min)

```bash
npx vitest run tests/integration/ --reporter=verbose
```

**Must pass:** All session, machine, and WebSocket integration tests against real DB.
**If fails:** Backend logic bug. Fix before deploying.

## Step 4: Security Headers (2 min)

```bash
npx vitest run tests/security/ --reporter=verbose
```

**Must pass:** All security headers present, IDOR protection working, cookies flagged correctly.
**If fails:** Security regression. Do NOT deploy.

## Step 5: UX Flow Smoke Test (5 min)

```bash
npx playwright test tests/e2e/onboarding.spec.ts tests/e2e/machine-setup.spec.ts --reporter=line
```

**Must pass:** New user can complete onboarding. Empty states show guidance.
**If fails:** User experience broken. Fix UX before deploying.

## Step 6: Visual Regression (2 min)

```bash
PERCY_TOKEN=$PERCY_TOKEN npx percy exec -- npx playwright test tests/visual/
```

**Must pass:** No unexpected visual changes. Percy review approved.
**If fails:** Check Percy dashboard. If intentional change, approve in Percy. If unintentional, fix.

## Step 7: Performance Baseline (5 min)

```bash
npx lighthouse https://staging.sessionforge.dev --output=json | node -e "
const r = JSON.parse(require('fs').readFileSync('/dev/stdin'));
const score = r.categories.performance.score * 100;
console.log('Performance score:', score);
if (score < 80) process.exit(1);
"
```

**Must pass:** Lighthouse performance >= 80.
**If fails:** Performance regression. Profile and fix.

## Step 8: Billing Flow (3 min)

```bash
STRIPE_TEST_SECRET_KEY=$STRIPE_TEST_SK npx playwright test tests/e2e/billing.spec.ts --reporter=line
```

**Must pass:** Free→pro upgrade works. Test card charged successfully.
**If fails:** Do NOT deploy. Billing bugs can cause real financial harm.

## Step 9: Checkly Synthetic Checks (1 min)

```bash
npx checkly test --record
```

**Must pass:** All production synthetic checks passing before the deploy window.
**If fails:** Something is already broken in production. Fix that first.

## Step 10: Final Checklist

Before hitting deploy:
- [ ] All 9 steps above: PASS
- [ ] `npm audit` shows no critical vulnerabilities
- [ ] ENV vars verified in Cloud Run / Vercel dashboard
- [ ] Rollback plan ready (previous image tag noted)
- [ ] Team notified of deploy window

## Post-Deploy (5 min after deploy)

- [ ] Checkly checks still passing
- [ ] Sentry: no new errors in first 5 minutes
- [ ] Spot-check: login works, dashboard loads, machines appear
- [ ] k6 quick check: `k6 run tests/performance/load.js --duration=1m`

---

**If anything fails post-deploy: roll back immediately, investigate, fix, re-run runbook.**
```

**Step 2: Commit**

```bash
cd C:/Users/Jakeb/sessionforge
git add docs/
git commit -m "docs: add qa-runbook pre-deploy gate skill"
```

---

### Task 15: Upgrade incident-response skill

**Files:**
- Modify: `~/.claude/skills/incident-response/SKILL.md`

**Step 1: Update the skill with current infrastructure**

Replace the outdated EC2 references and add SessionForge/Support Forge topology:

Key changes to make in `C:/Users/Jakeb/.claude/skills/incident-response/SKILL.md`:
- Replace `{LEGACY_EC2_IP}` with Cloud Run service URLs
- Add sessionforge.dev entry
- Add Vercel-based ai-consultant-toolkit entry
- Add "Proactive Detection" section before "Incident Triage" — Checkly alerts, Sentry notifications
- Add post-incident synthetic monitoring validation step

**Step 2: Add updated site table**

Replace the site table at the top with:
```markdown
| Site | Type | Host | Quick Check |
|------|------|------|-------------|
| support-forge.com | Static | Vercel/Cloud Run | `curl -I https://support-forge.com` |
| sessionforge.dev | Next.js + Postgres | Cloud Run | `gcloud run services describe sessionforge-web --region us-central1` |
| ai-consultant-toolkit.vercel.app | Next.js | Vercel | `curl -I https://ai-consultant-toolkit.vercel.app` |
| platorum.com | S3/CloudFront | AWS | `curl -I https://www.platorum.com` |

**Proactive Detection First:**
Before any manual triage, check Checkly and Sentry — the alert that woke you up should already tell you what broke.
```

**Step 3: Commit**

```bash
git add C:/Users/Jakeb/.claude/skills/incident-response/SKILL.md
git commit -m "docs: update incident-response skill with current infra topology"
```

---

### Task 16: Upgrade webapp-testing skill

**Files:**
- Modify: `~/.claude/skills/` (document-skills webapp-testing plugin)

**Step 1: Add SessionForge-specific patterns to webapp-testing**

Find the webapp-testing skill path and add:
```markdown
## SessionForge-Specific Patterns

### Auth Fixture (use in every test that needs a logged-in user)
```typescript
import { seedUser } from '../fixtures/users'
import { getAuthHeaders } from '../helpers/api'

test.beforeEach(async ({ page }) => {
  const user = await seedUser({ emailVerified: true })
  const headers = await getAuthHeaders()
  // Inject session cookie into Playwright context
  await page.context().addCookies([{
    name: 'next-auth.session-token',
    value: headers.Cookie.split('=')[1],
    domain: 'localhost',
    path: '/',
  }])
})
```

### WebSocket Test Helper
```typescript
import { expect } from '@playwright/test'

export async function waitForWebSocketMessage(page, expectedType: string) {
  return page.waitForEvent('websocket', ws =>
    ws.waitForEvent('framesent', frame =>
      JSON.parse(frame.payload).type === expectedType
    )
  )
}
```

### Empty State Check (always check this)
```typescript
// After any action that could leave a list empty:
await expect(page.getByText(/undefined|null|NaN/i)).not.toBeVisible()
await expect(page.getByRole('list')).toBeVisible() // Or guidance text
```
```

**Step 2: Commit all remaining skill files**

```bash
cd C:/Users/Jakeb
git add .claude/skills/
git commit -m "docs: upgrade webapp-testing, add all new QA skills"
```

---

## CI/CD Gate Configuration

### Task 17: Add GitHub Actions QA gate

**Files:**
- Create: `sessionforge/.github/workflows/qa-gate.yml`

**Step 1: Create QA gate workflow**

Create `sessionforge/.github/workflows/qa-gate.yml`:
```yaml
name: QA Gate

on:
  pull_request:
    branches: [main, dev/integration]
  push:
    branches: [main]

jobs:
  unit-and-contract:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: sessionforge_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx vitest run tests/unit/ tests/contract/ --reporter=verbose
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/sessionforge_test

  e2e:
    runs-on: ubuntu-latest
    needs: unit-and-contract
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test tests/e2e/auth.spec.ts tests/e2e/onboarding.spec.ts
        env:
          PLAYWRIGHT_BASE_URL: ${{ secrets.STAGING_URL }}
          MAILOSAUR_API_KEY: ${{ secrets.MAILOSAUR_API_KEY }}
          MAILOSAUR_SERVER_ID: ${{ secrets.MAILOSAUR_SERVER_ID }}

  security:
    runs-on: ubuntu-latest
    needs: unit-and-contract
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx vitest run tests/security/ --reporter=verbose
      - run: npm audit --audit-level=high

  visual:
    runs-on: ubuntu-latest
    needs: e2e
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx percy exec -- npx playwright test tests/visual/
        env:
          PERCY_TOKEN: ${{ secrets.PERCY_TOKEN }}
```

**Step 2: Add secrets to GitHub repo**

In GitHub → Settings → Secrets → Actions, add:
- `MAILOSAUR_API_KEY`
- `MAILOSAUR_SERVER_ID`
- `PERCY_TOKEN`
- `STRIPE_TEST_SECRET_KEY`
- `STAGING_URL`

**Step 3: Commit**

```bash
cd C:/Users/Jakeb/sessionforge
git add .github/workflows/qa-gate.yml
git commit -m "ci: add QA gate — unit, contract, E2E, security, visual regression"
```

---

## Summary: Skills Built

| Skill | Location | Status |
|---|---|---|
| `qa-auth-validator` | `~/.claude/skills/qa-auth-validator/` | Build Day 1 |
| `qa-seed-manager` (via db.ts + fixtures) | `agent-qa/tests/helpers/` | Build Day 1 |
| `qa-websocket` | `~/.claude/skills/qa-websocket/` | Build Day 2 |
| `qa-billing` | `~/.claude/skills/qa-billing/` | Build Day 2 |
| `api-contract-checker` | `~/.claude/skills/api-contract-checker/` | Build Day 2 |
| `qa-ux-flows` | `~/.claude/skills/qa-ux-flows/` | Build Day 3 |
| `qa-security` | `~/.claude/skills/qa-security/` | Build Day 3 |
| `qa-performance` | `~/.claude/skills/qa-performance/` | Build Day 3 |
| `qa-observability` | `~/.claude/skills/qa-observability/` | Build Day 3 |
| `qa-runbook` | `~/.claude/skills/qa-runbook/` | Build Day 3 |
| `incident-response` (upgraded) | `~/.claude/skills/incident-response/` | Day 3 |
| `webapp-testing` (upgraded) | document-skills plugin | Day 3 |

## Summary: What Each Day Delivers

**After Day 1:** Auth flows fully tested with real email verification. All `test.skip()` stubs unblocked. Real DB seeding working. Auth bugs surface.

**After Day 2:** Real API integration tests catching backend logic bugs. WebSocket resilience validated. Billing lifecycle tested through Stripe test clocks. Chaos scenarios exposing fragility.

**After Day 3:** Visual regressions caught automatically. Performance baselines established. Security sweep complete. User journeys tested from user's perspective. Proactive monitoring running 24/7 in production. Nothing ships without passing the qa-runbook gate.
