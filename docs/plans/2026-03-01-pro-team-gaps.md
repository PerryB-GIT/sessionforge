# Pro/Team Gaps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build webhook delivery, GCS session log archival, and org RBAC enforcement — all gated to Pro and Team plan tiers.

**Architecture:** Branch `feat/pro-team-gaps` from `main` (after `feat/core-gaps` is merged). Three independent features sharing the existing Drizzle schema + Upstash Redis. Webhook retries use Upstash Redis delayed queue. GCS access via Cloud Run service account (no new credentials needed). RBAC is a helper function applied to existing routes.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, PostgreSQL, Upstash Redis, Google Cloud Storage (`@google-cloud/storage`), Stripe, Vitest, Playwright

---

## Pre-Work: Create Branch

```bash
cd C:/Users/Jakeb/sessionforge
git checkout main && git pull
git checkout -b feat/pro-team-gaps
```

---

## Task 1: Add webhooks + webhook_deliveries tables to schema

**Files:**

- Modify: `apps/web/src/db/schema/index.ts`
- Create: migration via `npm run db:generate`

**Step 1: Write the failing test**

Create `apps/web/src/app/api/webhooks/__tests__/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('webhooks schema', () => {
  it('exports webhooks and webhookDeliveries tables', async () => {
    const schema = await import('@/db/schema')
    expect(schema.webhooks).toBeDefined()
    expect(schema.webhookDeliveries).toBeDefined()
  })
})
```

**Step 2: Run to verify failure**

```bash
cd apps/web
npx vitest run src/app/api/webhooks/__tests__/schema.test.ts
```

Expected: FAIL.

**Step 3: Add tables to schema**

In `apps/web/src/db/schema/index.ts`, after the `notifications` table, add:

```typescript
// ─── Webhook Delivery Status ──────────────────────────────────────────────────

export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'delivered',
  'failed',
])

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    url: varchar('url', { length: 2048 }).notNull(),
    secret: varchar('secret', { length: 64 }).notNull(),
    events: text('events')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('webhooks_user_id_idx').on(table.userId),
  })
)

// ─── Webhook Deliveries ───────────────────────────────────────────────────────

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: varchar('event', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    responseCode: integer('response_code'),
    responseBody: text('response_body'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    webhookIdIdx: index('webhook_deliveries_webhook_id_idx').on(table.webhookId),
    statusIdx: index('webhook_deliveries_status_idx').on(table.status),
  })
)

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  user: one(users, { fields: [webhooks.userId], references: [users.id] }),
  org: one(organizations, { fields: [webhooks.orgId], references: [organizations.id] }),
  deliveries: many(webhookDeliveries),
}))

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, { fields: [webhookDeliveries.webhookId], references: [webhooks.id] }),
}))
```

**Step 4: Generate migration**

```bash
npm run db:generate
```

Review the generated SQL — should create both tables and the enum.

**Step 5: Run test to verify it passes**

```bash
npx vitest run src/app/api/webhooks/__tests__/schema.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/db/schema/index.ts apps/web/src/db/migrations/
git commit -m "feat: add webhooks and webhook_deliveries tables"
```

---

## Task 2: Build the webhook delivery library

**Files:**

- Create: `apps/web/src/lib/webhook-delivery.ts`

**Step 1: Write the failing test**

Create `apps/web/src/lib/__tests__/webhook-delivery.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('signWebhookPayload', () => {
  it('produces a sha256 HMAC signature', async () => {
    const { signWebhookPayload } = await import('../webhook-delivery')
    const sig = await signWebhookPayload('my-secret', '{"event":"test"}')
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('produces different signatures for different secrets', async () => {
    const { signWebhookPayload } = await import('../webhook-delivery')
    const sig1 = await signWebhookPayload('secret-a', '{"event":"test"}')
    const sig2 = await signWebhookPayload('secret-b', '{"event":"test"}')
    expect(sig1).not.toBe(sig2)
  })
})
```

**Step 2: Run to verify failure**

```bash
npx vitest run src/lib/__tests__/webhook-delivery.test.ts
```

Expected: FAIL — module not found.

**Step 3: Create the library**

Create `apps/web/src/lib/webhook-delivery.ts`:

```typescript
import crypto from 'crypto'
import { eq, and, inArray } from 'drizzle-orm'
import { db, webhooks, webhookDeliveries } from '@/db'

export type WebhookEvent =
  | 'session.started'
  | 'session.stopped'
  | 'session.crashed'
  | 'machine.online'
  | 'machine.offline'

export async function signWebhookPayload(secret: string, body: string): Promise<string> {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body)
  return `sha256=${hmac.digest('hex')}`
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function deliverWebhook(
  event: WebhookEvent,
  payload: Record<string, unknown>,
  userId: string
): Promise<void> {
  // Find all enabled webhooks for this user that subscribe to this event
  const targets = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.userId, userId), eq(webhooks.enabled, true)))

  const subscribedTargets = targets.filter(
    (w) => (w.events as string[]).includes(event) || (w.events as string[]).includes('*')
  )

  if (subscribedTargets.length === 0) return

  const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() })

  await Promise.allSettled(
    subscribedTargets.map((webhook) => attemptDelivery(webhook, event, body, payload))
  )
}

async function attemptDelivery(
  webhook: typeof webhooks.$inferSelect,
  event: WebhookEvent,
  body: string,
  payload: Record<string, unknown>
): Promise<void> {
  const signature = await signWebhookPayload(webhook.secret, body)

  // Create delivery record
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      webhookId: webhook.id,
      event,
      payload: payload as Record<string, unknown>,
      status: 'pending',
      attempts: 0,
    })
    .returning()

  await sendWithRetry(webhook.url, body, signature, delivery.id, 1)
}

async function sendWithRetry(
  url: string,
  body: string,
  signature: string,
  deliveryId: string,
  attempt: number
): Promise<void> {
  const MAX_ATTEMPTS = 3
  const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] // 1min, 5min, 30min

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SessionForge-Signature': signature,
        'X-SessionForge-Event': 'webhook',
        'User-Agent': 'SessionForge-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    const responseBody = await res.text().catch(() => '')

    await db
      .update(webhookDeliveries)
      .set({
        status: res.ok ? 'delivered' : 'failed',
        responseCode: res.status,
        responseBody: responseBody.slice(0, 1000),
        attempts: attempt,
        lastAttemptAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId))

    if (!res.ok && attempt < MAX_ATTEMPTS) {
      setTimeout(
        () => sendWithRetry(url, body, signature, deliveryId, attempt + 1),
        RETRY_DELAYS_MS[attempt - 1]
      )
    }
  } catch {
    await db
      .update(webhookDeliveries)
      .set({
        status: attempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts: attempt,
        lastAttemptAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId))

    if (attempt < MAX_ATTEMPTS) {
      setTimeout(
        () => sendWithRetry(url, body, signature, deliveryId, attempt + 1),
        RETRY_DELAYS_MS[attempt - 1]
      )
    }
  }
}
```

**Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/webhook-delivery.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/lib/webhook-delivery.ts apps/web/src/lib/__tests__/webhook-delivery.test.ts
git commit -m "feat: add webhook delivery library with HMAC signing and retry"
```

---

## Task 3: Build webhook API routes

**Files:**

- Create: `apps/web/src/app/api/webhooks/route.ts`
- Create: `apps/web/src/app/api/webhooks/[id]/route.ts`
- Create: `apps/web/src/app/api/webhooks/[id]/deliveries/route.ts`

**Step 1: Write the failing test**

Create `apps/web/src/app/api/webhooks/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('POST /api/webhooks', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['session.started'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 for free plan user', async () => {
    vi.mock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({ user: { id: 'user-1', plan: 'free' } }),
    }))
    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['session.started'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })
})
```

**Step 2: Run to verify failures**

```bash
npx vitest run src/app/api/webhooks/__tests__/route.test.ts
```

Expected: FAIL.

**Step 3: Create `POST /api/webhooks` and `GET /api/webhooks`**

Create `apps/web/src/app/api/webhooks/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, webhooks, users } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import { generateWebhookSecret } from '@/lib/webhook-delivery'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const VALID_EVENTS = [
  'session.started',
  'session.stopped',
  'session.crashed',
  'machine.online',
  'machine.offline',
  '*',
] as const

const createSchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048),
  events: z.array(z.enum(VALID_EVENTS)).min(1, 'Select at least one event'),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  const items = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      enabled: webhooks.enabled,
      createdAt: webhooks.createdAt,
    })
    .from(webhooks)
    .where(eq(webhooks.userId, session.user.id))
    .orderBy(webhooks.createdAt)

  return NextResponse.json({ data: items, error: null } satisfies ApiResponse<typeof items>)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  // Plan gate
  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  const plan = (userRow?.plan ?? 'free') as PlanTier
  if (!isFeatureAvailable(plan, 'webhooks')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'Webhooks require a Pro plan or above',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0].message,
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  const secret = generateWebhookSecret()

  const [created] = await db
    .insert(webhooks)
    .values({
      userId: session.user.id,
      url: parsed.data.url,
      events: parsed.data.events as string[],
      secret,
    })
    .returning()

  // Return secret only once at creation time
  return NextResponse.json({ data: { ...created, secret }, error: null }, { status: 201 })
}
```

**Step 4: Create `DELETE /api/webhooks/[id]`**

Create `apps/web/src/app/api/webhooks/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, webhooks } from '@/db'
import type { ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  const deleted = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, params.id), eq(webhooks.userId, session.user.id)))
    .returning({ id: webhooks.id })

  if (deleted.length === 0) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Webhook not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json({ data: { ok: true }, error: null })
}
```

**Step 5: Create `GET /api/webhooks/[id]/deliveries`**

Create `apps/web/src/app/api/webhooks/[id]/deliveries/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, and, desc } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, webhooks, webhookDeliveries } from '@/db'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  // Verify ownership
  const [webhook] = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.id, params.id), eq(webhooks.userId, session.user.id)))
    .limit(1)

  if (!webhook) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Webhook not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, params.id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50)

  return NextResponse.json({ data: deliveries, error: null } satisfies ApiResponse<
    typeof deliveries
  >)
}
```

**Step 6: Run tests**

```bash
npx vitest run src/app/api/webhooks/__tests__/route.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/web/src/app/api/webhooks/
git commit -m "feat: add webhook CRUD API routes with plan gate"
```

---

## Task 4: Wire webhook delivery into the WS server

**Files:**

- Modify: `apps/web/server.js`

**Step 1: Find event dispatch points in server.js**

```bash
grep -n "session_started\|session_stopped\|session_crashed\|machine.*online\|machine.*offline" apps/web/server.js | head -20
```

**Step 2: Add deliverWebhook calls**

At each of these event handling points, add after the DB update:

For `session_started`:

```javascript
try {
  const { deliverWebhook } = await import('./src/lib/webhook-delivery.js')
  await deliverWebhook(
    'session.started',
    { sessionId: session.id, machineId: session.machineId },
    session.userId
  )
} catch (err) {
  console.error('[webhooks] delivery error on session.started:', err)
}
```

For `session_stopped`:

```javascript
try {
  const { deliverWebhook } = await import('./src/lib/webhook-delivery.js')
  await deliverWebhook(
    'session.stopped',
    { sessionId: session.id, machineId: session.machineId },
    session.userId
  )
} catch (err) {
  console.error('[webhooks] delivery error on session.stopped:', err)
}
```

For `session_crashed`:

```javascript
try {
  const { deliverWebhook } = await import('./src/lib/webhook-delivery.js')
  await deliverWebhook(
    'session.crashed',
    { sessionId: session.id, machineId: session.machineId },
    session.userId
  )
} catch (err) {
  console.error('[webhooks] delivery error on session.crashed:', err)
}
```

For machine online/offline transitions:

```javascript
try {
  const { deliverWebhook } = await import('./src/lib/webhook-delivery.js')
  await deliverWebhook(
    isOnline ? 'machine.online' : 'machine.offline',
    { machineId: machine.id, hostname: machine.hostname },
    machine.userId
  )
} catch (err) {
  console.error('[webhooks] delivery error on machine status:', err)
}
```

**Step 3: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 4: Commit**

```bash
git add apps/web/server.js
git commit -m "feat: fire webhook deliveries on session and machine events"
```

---

## Task 5: Build the Webhooks dashboard page + sidebar entry

**Files:**

- Create: `apps/web/src/app/(dashboard)/webhooks/page.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

**Step 1: Add sidebar entry**

Open `apps/web/src/components/layout/Sidebar.tsx`. Find where nav items are defined. Add an entry that is only shown when the user's plan supports webhooks:

```tsx
// Near other nav items, add:
{
  isFeatureAvailable((session?.user?.plan as PlanTier) ?? 'free', 'webhooks') && (
    <SidebarItem href="/webhooks" icon={Webhook} label="Webhooks" />
  )
}
```

Import `Webhook` from `lucide-react` and `isFeatureAvailable`, `PlanTier` from `@sessionforge/shared-types`.

**Step 2: Create the webhooks page**

Create `apps/web/src/app/(dashboard)/webhooks/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, ExternalLink, CheckCircle, XCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

const VALID_EVENTS = [
  { value: 'session.started', label: 'Session started' },
  { value: 'session.stopped', label: 'Session stopped' },
  { value: 'session.crashed', label: 'Session crashed' },
  { value: 'machine.online', label: 'Machine online' },
  { value: 'machine.offline', label: 'Machine offline' },
]

interface Webhook {
  id: string
  url: string
  events: string[]
  enabled: boolean
  createdAt: string
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/webhooks')
    const j = await res.json()
    setWebhooks(j.data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function create() {
    setIsCreating(true)
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl, events: selectedEvents }),
      })
      const j = await res.json()
      if (!res.ok) {
        toast.error(j.error?.message ?? 'Failed to create webhook')
        return
      }
      setNewSecret(j.data.secret)
      setNewUrl('')
      setSelectedEvents([])
      await load()
    } finally {
      setIsCreating(false)
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to delete webhook')
      return
    }
    setWebhooks((prev) => prev.filter((w) => w.id !== id))
    toast.success('Webhook removed')
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Webhooks</h2>
          <p className="text-sm text-gray-400">
            Receive HTTP POST events when sessions and machines change state
          </p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o)
            if (!o) setNewSecret(null)
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Add Endpoint
            </Button>
          </DialogTrigger>
          <DialogContent className="border-[#1e1e2e] bg-[#0a0a0f]">
            <DialogHeader>
              <DialogTitle className="text-white">Add webhook endpoint</DialogTitle>
            </DialogHeader>
            {newSecret ? (
              <div className="space-y-3">
                <p className="text-sm text-green-400">
                  Webhook created. Copy your signing secret — it won&apos;t be shown again.
                </p>
                <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-3 font-mono text-xs text-gray-300 break-all">
                  {newSecret}
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(newSecret)
                    toast.success('Copied!')
                  }}
                >
                  Copy Secret
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Endpoint URL</label>
                  <Input
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://your-app.com/webhooks"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Events</label>
                  <div className="space-y-2">
                    {VALID_EVENTS.map(({ value, label }) => (
                      <label key={value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEvents.includes(value)}
                          onChange={(e) =>
                            setSelectedEvents((prev) =>
                              e.target.checked ? [...prev, value] : prev.filter((v) => v !== value)
                            )
                          }
                          className="h-4 w-4 accent-purple-500"
                        />
                        <span className="text-sm text-gray-300">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={create}
                  isLoading={isCreating}
                  disabled={!newUrl || selectedEvents.length === 0}
                >
                  Create Endpoint
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {webhooks.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500 text-sm">No webhook endpoints configured.</p>
          </CardContent>
        </Card>
      )}

      {webhooks.map((w) => (
        <Card key={w.id}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-mono text-gray-200 truncate">{w.url}</CardTitle>
                <CardDescription className="mt-1 flex flex-wrap gap-1">
                  {w.events.map((e) => (
                    <Badge key={e} variant="secondary" className="text-[10px]">
                      {e}
                    </Badge>
                  ))}
                </CardDescription>
              </div>
              <button
                onClick={() => remove(w.id)}
                className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}
```

**Step 3: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/webhooks/ apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat: add webhooks dashboard page and sidebar entry"
```

---

## Task 6: GCS session log archival

**Files:**

- Create: `apps/web/src/lib/gcs-logs.ts`
- Modify: `apps/web/src/app/api/sessions/[id]/logs/route.ts`
- Modify: `apps/web/server.js`

**Step 1: Install GCS client**

```bash
cd apps/web
npm install @google-cloud/storage
```

**Step 2: Create the GCS logs library**

Create `apps/web/src/lib/gcs-logs.ts`:

```typescript
import { Storage } from '@google-cloud/storage'
import zlib from 'zlib'
import { promisify } from 'util'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

function getStorage() {
  // On Cloud Run, ADC (Application Default Credentials) are used automatically.
  // In development, set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.
  return new Storage()
}

function getBucket() {
  const bucket = process.env.GCS_BUCKET_LOGS
  if (!bucket) throw new Error('GCS_BUCKET_LOGS env var is not set')
  return getStorage().bucket(bucket)
}

export async function archiveSessionLogs(
  sessionId: string,
  userId: string,
  lines: string[]
): Promise<void> {
  if (lines.length === 0) return

  const content = lines.join('\n')
  const compressed = await gzip(Buffer.from(content, 'utf-8'))

  const file = getBucket().file(`session-logs/${userId}/${sessionId}.ndjson.gz`)
  await file.save(compressed, {
    contentType: 'application/gzip',
    metadata: { sessionId, userId },
  })
}

export async function fetchLogsFromGCS(
  sessionId: string,
  userId: string,
  offset: number,
  limit: number
): Promise<{ lines: string[]; total: number }> {
  const file = getBucket().file(`session-logs/${userId}/${sessionId}.ndjson.gz`)

  const [exists] = await file.exists()
  if (!exists) return { lines: [], total: 0 }

  const [compressed] = await file.download()
  const content = (await gunzip(compressed)).toString('utf-8')
  const allLines = content.split('\n').filter(Boolean)

  return {
    lines: allLines.slice(offset, offset + limit),
    total: allLines.length,
  }
}
```

**Step 3: Update the logs route to implement GCS fallback + history gate**

Open `apps/web/src/app/api/sessions/[id]/logs/route.ts`. Replace the STUB comment block and add the full implementation after the Redis fetch:

```typescript
// If Redis has data, return it
if (rawLines.length > 0) {
  const response: SessionLogsResponse = {
    sessionId: params.id,
    lines: rawLines as string[],
    total,
    source: 'redis',
  }
  return NextResponse.json({
    data: response,
    error: null,
  } satisfies ApiResponse<SessionLogsResponse>)
}

// Redis empty — session must be stopped. Check GCS and history gate.
if (record.status !== 'running') {
  // Enforce plan history limit
  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  const plan = (userRow?.plan ?? 'free') as PlanTier
  const limits = PLAN_LIMITS[plan]

  if (record.stoppedAt && limits.historyDays > 0) {
    const ageMs = Date.now() - new Date(record.stoppedAt).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    if (ageDays > limits.historyDays) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: 'HISTORY_LIMIT',
            message: `Session logs older than ${limits.historyDays} days require a higher plan`,
            statusCode: 403,
          },
        } satisfies ApiError,
        { status: 403 }
      )
    }
  }

  // Fetch from GCS
  try {
    const { fetchLogsFromGCS } = await import('@/lib/gcs-logs')
    const gcsResult = await fetchLogsFromGCS(params.id, session.user.id, offset, limit)
    if (gcsResult.lines.length > 0) {
      return NextResponse.json({
        data: {
          sessionId: params.id,
          lines: gcsResult.lines,
          total: gcsResult.total,
          source: 'gcs',
        },
        error: null,
      } satisfies ApiResponse<SessionLogsResponse>)
    }
  } catch (err) {
    console.error('[GET /api/sessions/:id/logs] GCS fetch failed:', err)
    // Fall through to empty response
  }
}
```

Add the following imports to the top of the logs route:

```typescript
import { users } from '@/db'
import { PLAN_LIMITS } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'
```

Also update the session select to include `stoppedAt`:

```typescript
const [record] = await db
  .select({ id: sessions.id, status: sessions.status, stoppedAt: sessions.stoppedAt })
  .from(sessions)
  .where(and(eq(sessions.id, params.id), eq(sessions.userId, session.user.id)))
  .limit(1)
```

**Step 4: Wire archiveSessionLogs into server.js**

In `server.js`, find the `session_stopped` handler. After the DB status update, add:

```javascript
try {
  const { redis, RedisKeys } = await import('./src/lib/redis.js')
  const { archiveSessionLogs } = await import('./src/lib/gcs-logs.js')
  const logKey = RedisKeys.sessionLogs(session.id)
  const lines = await redis.lrange(logKey, 0, -1)
  if (lines.length > 0) {
    await archiveSessionLogs(session.id, session.userId, lines)
  }
} catch (err) {
  console.error('[gcs-logs] archive failed for session', session.id, ':', err)
}
```

**Step 5: Add GCS_BUCKET_LOGS to env docs**

Add to `.env.example` (or wherever env vars are documented):

```
GCS_BUCKET_LOGS=sessionforge-session-logs
```

**Step 6: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 7: Commit**

```bash
git add apps/web/src/lib/gcs-logs.ts apps/web/src/app/api/sessions/ apps/web/server.js
git commit -m "feat: implement GCS session log archival with plan history gate"
```

---

## Task 7: RBAC helper and org route enforcement

**Files:**

- Create: `apps/web/src/lib/org-auth.ts`
- Modify: `apps/web/src/app/api/org/members/route.ts`
- Modify: `apps/web/src/app/api/org/invites/[token]/route.ts`
- Modify: `apps/web/src/app/api/org/route.ts`
- Modify: `apps/web/src/app/api/machines/route.ts`
- Modify: `apps/web/src/app/api/sessions/route.ts`

**Step 1: Write failing tests**

Create `apps/web/src/lib/__tests__/org-auth.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('requireOrgRole', () => {
  it('throws 403 when user is not an org member', async () => {
    vi.mock('@/db', () => ({
      db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      },
      orgMembers: {},
    }))
    const { requireOrgRole } = await import('../org-auth')
    const session = { user: { id: 'user-1' } }
    await expect(requireOrgRole(session as any, 'org-1', 'member')).rejects.toMatchObject({
      status: 403,
    })
  })
})
```

**Step 2: Run to verify failure**

```bash
npx vitest run src/lib/__tests__/org-auth.test.ts
```

Expected: FAIL.

**Step 3: Create the RBAC helper**

Create `apps/web/src/lib/org-auth.ts`:

```typescript
import { eq, and } from 'drizzle-orm'
import { db, orgMembers } from '@/db'
import type { Session } from 'next-auth'

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'

const ROLE_RANK: Record<MemberRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

class OrgAuthError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Throws an OrgAuthError if the authenticated user does not have
 * at least `minRole` in the given org. Otherwise returns the user's role.
 */
export async function requireOrgRole(
  session: Session | null,
  orgId: string,
  minRole: MemberRole
): Promise<MemberRole> {
  if (!session?.user?.id) {
    throw new OrgAuthError('Authentication required', 401, 'UNAUTHORIZED')
  }

  const [membership] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, session.user.id)))
    .limit(1)

  if (!membership) {
    throw new OrgAuthError('You are not a member of this organization', 403, 'FORBIDDEN')
  }

  const userRank = ROLE_RANK[membership.role as MemberRole]
  const requiredRank = ROLE_RANK[minRole]

  if (userRank < requiredRank) {
    throw new OrgAuthError(
      `This action requires ${minRole} role or above`,
      403,
      'INSUFFICIENT_ROLE'
    )
  }

  return membership.role as MemberRole
}

/** Convert an OrgAuthError into a NextResponse-compatible object */
export function orgAuthErrorResponse(err: unknown) {
  if (err instanceof OrgAuthError) {
    return { status: err.status, code: err.code, message: err.message }
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
}
```

**Step 4: Apply to POST /api/org/members**

Open `apps/web/src/app/api/org/members/route.ts`. After authenticating the session, add:

```typescript
import { requireOrgRole, orgAuthErrorResponse } from '@/lib/org-auth'

// In the POST handler, after getting the org:
try {
  await requireOrgRole(session, org.id, 'admin')
} catch (err) {
  const { status, code, message } = orgAuthErrorResponse(err)
  return NextResponse.json({ data: null, error: { code, message, statusCode: status } }, { status })
}
```

**Step 5: Apply to DELETE /api/org/invites/[token]**

Open `apps/web/src/app/api/org/invites/[token]/route.ts`. Find the DELETE handler. After getting the org from the invite token, add the same `requireOrgRole(session, org.id, 'admin')` check.

**Step 6: Apply to PATCH /api/org (org settings)**

Open `apps/web/src/app/api/org/route.ts`. In the PATCH handler, add:

```typescript
await requireOrgRole(session, org.id, 'owner')
```

**Step 7: Apply to POST /api/sessions (viewer block)**

Open `apps/web/src/app/api/sessions/route.ts`. When a session targets an org machine (i.e., `machine.orgId` is not null), add:

```typescript
if (machine.orgId) {
  try {
    await requireOrgRole(session, machine.orgId, 'member')
  } catch (err) {
    const { status, code, message } = orgAuthErrorResponse(err)
    return NextResponse.json(
      { data: null, error: { code, message, statusCode: status } },
      { status }
    )
  }
}
```

**Step 8: Run tests**

```bash
npx vitest run src/lib/__tests__/org-auth.test.ts
```

Expected: PASS.

**Step 9: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 10: Commit**

```bash
git add apps/web/src/lib/org-auth.ts apps/web/src/lib/__tests__/org-auth.test.ts \
  apps/web/src/app/api/org/ apps/web/src/app/api/sessions/route.ts
git commit -m "feat: add RBAC helper and enforce org roles on protected routes"
```

---

## Task 8: Run migrations and full QA gate

**Step 1: Apply migrations**

```bash
cd apps/web && npm run db:migrate
```

**Step 2: Add GCS_BUCKET_LOGS to local .env**

```
GCS_BUCKET_LOGS=sessionforge-session-logs-dev
```

Create the bucket in GCP Console if it doesn't exist, or use the existing one.

**Step 3: Run unit tests**

```bash
cd C:/Users/Jakeb/sessionforge && npm run test:unit
```

Expected: 0 failures.

**Step 4: Run integration tests**

```bash
npm run test:integration
```

Expected: 0 failures.

**Step 5: Run full QA runbook**

Follow `/qa-runbook` — all 9 steps must pass.

**Step 6: Push and open PR**

```bash
git push -u origin feat/pro-team-gaps
```

Open PR against `main`. Title: `feat: webhooks, GCS log archival, and org RBAC (Pro/Team tier)`.
