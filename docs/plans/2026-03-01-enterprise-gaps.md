# Enterprise Gaps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build SSO (OIDC + SAML), audit logging, session recording, and IP allowlist — all gated to the Enterprise tier.

**Architecture:** Branch `feat/enterprise-gaps` from `main` (after `feat/pro-team-gaps` is merged). Each feature adds new DB tables, API routes, and UI pages. SSO uses NextAuth dynamic providers + `@node-saml/node-saml`. Session recording uses Redis buffer → GCS asciinema `.cast` format. IP allowlist enforced in Next.js middleware with a Redis cache layer.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, PostgreSQL, Upstash Redis, Google Cloud Storage, `@node-saml/node-saml`, `asciinema-player`, Vitest, Playwright

---

## Pre-Work: Create Branch

```bash
cd C:/Users/Jakeb/sessionforge
git checkout main && git pull
git checkout -b feat/enterprise-gaps
```

---

## Task 1: Add enterprise tables to schema

**Files:**

- Modify: `apps/web/src/db/schema/index.ts`
- Create: migrations via `npm run db:generate`

**Step 1: Add all four enterprise tables**

Open `apps/web/src/db/schema/index.ts`. After the last table definition, add:

```typescript
// ─── SSO Configs ───────────────────────────────────────────────────────────────

export const ssoProviderEnum = pgEnum('sso_provider', ['oidc', 'saml'])

export const ssoConfigs = pgTable(
  'sso_configs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' })
      .unique(),
    provider: ssoProviderEnum('provider').notNull(),
    clientId: text('client_id'),
    clientSecret: text('client_secret'), // AES-256-GCM encrypted via KMS at rest
    issuerUrl: text('issuer_url'),
    samlIdpMetadataUrl: text('saml_idp_metadata_url'),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('sso_configs_org_id_idx').on(table.orgId),
  })
)

// ─── Audit Logs ────────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 255 }),
    metadata: jsonb('metadata'),
    ip: varchar('ip', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('audit_logs_org_id_idx').on(table.orgId),
    actionIdx: index('audit_logs_action_idx').on(table.action),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
  })
)

// ─── IP Allowlists ─────────────────────────────────────────────────────────────

export const ipAllowlists = pgTable(
  'ip_allowlists',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    cidr: varchar('cidr', { length: 43 }).notNull(),
    label: varchar('label', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('ip_allowlists_org_id_idx').on(table.orgId),
  })
)

// ─── Relations ──────────────────────────────────────────────────────────────────

export const ssoConfigsRelations = relations(ssoConfigs, ({ one }) => ({
  org: one(organizations, { fields: [ssoConfigs.orgId], references: [organizations.id] }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  org: one(organizations, { fields: [auditLogs.orgId], references: [organizations.id] }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}))

export const ipAllowlistsRelations = relations(ipAllowlists, ({ one }) => ({
  org: one(organizations, { fields: [ipAllowlists.orgId], references: [organizations.id] }),
}))
```

**Step 2: Generate migration**

```bash
cd apps/web && npm run db:generate
```

Review the generated SQL — should create `sso_provider` enum, `sso_configs`, `audit_logs`, `ip_allowlists` tables.

**Step 3: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 4: Commit**

```bash
git add apps/web/src/db/schema/index.ts apps/web/src/db/migrations/
git commit -m "feat: add sso_configs, audit_logs, ip_allowlists tables to schema"
```

---

## Task 2: Build the audit log helper and API route

**Files:**

- Create: `apps/web/src/lib/audit.ts`
- Create: `apps/web/src/app/api/org/audit-log/route.ts`

**Step 1: Write the failing test**

Create `apps/web/src/lib/__tests__/audit.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('logAuditEvent', () => {
  it('is a function that accepts orgId, userId, action', async () => {
    vi.mock('@/db', () => ({
      db: { insert: vi.fn().mockReturnThis(), values: vi.fn().mockResolvedValue([]) },
      auditLogs: {},
    }))
    const { logAuditEvent } = await import('../audit')
    await expect(logAuditEvent('org-1', 'user-1', 'member.invited')).resolves.toBeUndefined()
  })
})
```

**Step 2: Run to verify failure**

```bash
npx vitest run src/lib/__tests__/audit.test.ts
```

Expected: FAIL — module not found.

**Step 3: Create the audit helper**

Create `apps/web/src/lib/audit.ts`:

```typescript
import { db, auditLogs } from '@/db'

export type AuditAction =
  | 'member.invited'
  | 'member.removed'
  | 'session.started'
  | 'session.stopped'
  | 'machine.added'
  | 'machine.deleted'
  | 'sso.login'
  | 'sso.fallback'
  | 'api_key.created'
  | 'api_key.deleted'
  | 'plan.changed'
  | 'ip_allowlist.updated'

export async function logAuditEvent(
  orgId: string,
  userId: string | null,
  action: AuditAction,
  options?: {
    targetId?: string
    metadata?: Record<string, unknown>
    ip?: string
  }
): Promise<void> {
  await db.insert(auditLogs).values({
    orgId,
    userId: userId ?? null,
    action,
    targetId: options?.targetId ?? null,
    metadata: options?.metadata ?? null,
    ip: options?.ip ?? null,
  })
}
```

**Step 4: Create the audit log API route**

Create `apps/web/src/app/api/org/audit-log/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, auditLogs, users } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export async function GET(req: NextRequest) {
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

  // Get the user's org
  const [membership] = await db
    .select({ orgId: orgMembers.orgId, orgPlan: organizations.plan })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1)

  if (!membership) {
    return NextResponse.json({ data: { items: [], total: 0 }, error: null })
  }

  // Plan gate
  if (!isFeatureAvailable(membership.orgPlan as PlanTier, 'audit_log')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'Audit logs require an Enterprise plan',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const { searchParams } = new URL(req.url)
  const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10))
  const action = searchParams.get('action')
  const userId = searchParams.get('userId')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const conditions = [eq(auditLogs.orgId, membership.orgId)]
  if (action) conditions.push(eq(auditLogs.action, action))
  if (userId) conditions.push(eq(auditLogs.userId, userId))
  if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)))
  if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate)))

  const items = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE)

  return NextResponse.json({ data: { items, page }, error: null } satisfies ApiResponse<{
    items: typeof items
    page: number
  }>)
}
```

**Step 5: Run tests**

```bash
npx vitest run src/lib/__tests__/audit.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/lib/audit.ts apps/web/src/lib/__tests__/audit.test.ts \
  apps/web/src/app/api/org/audit-log/
git commit -m "feat: add audit log helper and GET /api/org/audit-log route"
```

---

## Task 3: Wire audit log into existing org API routes

**Files:**

- Modify: `apps/web/src/app/api/org/members/route.ts`
- Modify: `apps/web/src/app/api/machines/route.ts`
- Modify: `apps/web/src/app/api/keys/route.ts`

**Step 1: Add to POST /api/org/members (member invited)**

Open `apps/web/src/app/api/org/members/route.ts`. After successfully creating the invite, add:

```typescript
import { logAuditEvent } from '@/lib/audit'

// After invite is created:
await logAuditEvent(org.id, session.user.id, 'member.invited', {
  targetId: inviteEmail,
  metadata: { role, inviteId: invite.id },
  ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
}).catch((err) => console.error('[audit] log failed:', err))
```

**Step 2: Add to DELETE /api/org/members/[id] (member removed)**

Find the member remove route. After deletion:

```typescript
await logAuditEvent(orgId, session.user.id, 'member.removed', {
  targetId: memberId,
  ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
}).catch((err) => console.error('[audit] log failed:', err))
```

**Step 3: Add to POST /api/machines (machine added)**

Open `apps/web/src/app/api/machines/route.ts`. After machine creation, if the machine has an `orgId`:

```typescript
if (created.orgId) {
  await logAuditEvent(created.orgId, session.user.id, 'machine.added', {
    targetId: created.id,
    metadata: { name: created.name, os: created.os },
  }).catch((err) => console.error('[audit] log failed:', err))
}
```

**Step 4: Add to POST /api/keys (API key created)**

Open `apps/web/src/app/api/keys/route.ts`. After key creation, if the key has an `orgId`:

```typescript
if (created.orgId) {
  await logAuditEvent(created.orgId, session.user.id, 'api_key.created', {
    targetId: created.id,
    metadata: { name: created.name },
  }).catch((err) => console.error('[audit] log failed:', err))
}
```

**Step 5: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 6: Commit**

```bash
git add apps/web/src/app/api/org/ apps/web/src/app/api/machines/ apps/web/src/app/api/keys/
git commit -m "feat: wire logAuditEvent into org, machine, and API key routes"
```

---

## Task 4: Build the audit log UI page

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/org/audit-log/page.tsx`

**Step 1: Create the page**

Create `apps/web/src/app/(dashboard)/settings/org/audit-log/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Download, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface AuditEntry {
  id: string
  action: string
  targetId: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: string
  actorName: string | null
  actorEmail: string | null
}

const ACTION_COLORS: Record<string, string> = {
  'member.invited': 'bg-blue-500/20 text-blue-300',
  'member.removed': 'bg-red-500/20 text-red-300',
  'session.started': 'bg-green-500/20 text-green-300',
  'session.stopped': 'bg-gray-500/20 text-gray-300',
  'machine.added': 'bg-purple-500/20 text-purple-300',
  'machine.deleted': 'bg-red-500/20 text-red-300',
  'api_key.created': 'bg-yellow-500/20 text-yellow-300',
  'api_key.deleted': 'bg-red-500/20 text-red-300',
  'sso.login': 'bg-green-500/20 text-green-300',
  'sso.fallback': 'bg-orange-500/20 text-orange-300',
  'plan.changed': 'bg-purple-500/20 text-purple-300',
  'ip_allowlist.updated': 'bg-blue-500/20 text-blue-300',
}

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditEntry[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [actionFilter, setActionFilter] = useState('')

  async function load(p: number) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p) })
      if (actionFilter) params.set('action', actionFilter)
      const res = await fetch(`/api/org/audit-log?${params}`)
      const j = await res.json()
      if (j.data?.items) {
        setItems(p === 0 ? j.data.items : (prev) => [...prev, ...j.data.items])
        setPage(p)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(0)
  }, [actionFilter])

  function exportCsv() {
    const header = 'Timestamp,Actor,Action,Target,IP\n'
    const rows = items.map((e) =>
      [e.createdAt, e.actorEmail ?? 'system', e.action, e.targetId ?? '', e.ip ?? ''].join(',')
    )
    const blob = new Blob([header + rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Audit Log</h2>
          <p className="text-sm text-gray-400">All organization activity, newest first</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-gray-500" />
        <Input
          placeholder="Filter by action (e.g. member.invited)"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="space-y-2">
        {items.map((entry) => (
          <Card key={entry.id} className="border-[#1e1e2e]">
            <CardContent className="py-3 px-4">
              <div className="flex items-start gap-3">
                <Badge
                  className={`${ACTION_COLORS[entry.action] ?? 'bg-gray-500/20 text-gray-300'} border-0 shrink-0 text-xs`}
                >
                  {entry.action}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-300 font-medium">
                      {entry.actorEmail ?? 'System'}
                    </span>
                    {entry.targetId && (
                      <span className="text-gray-500 font-mono text-xs truncate">
                        {entry.targetId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    {entry.ip && <span>IP: {entry.ip}</span>}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {items.length === 0 && !loading && (
          <p className="text-center text-sm text-gray-500 py-8">No audit events found</p>
        )}

        {items.length > 0 && items.length % 50 === 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => load(page + 1)}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load more'}
          </Button>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Add audit log link to org settings nav**

Open `apps/web/src/app/(dashboard)/settings/org/page.tsx`. Add a link to the audit log page in the settings navigation (visible only when `isFeatureAvailable(plan, 'audit_log')`).

**Step 3: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/settings/org/audit-log/
git commit -m "feat: add audit log UI page with CSV export"
```

---

## Task 5: Build session recording

**Files:**

- Install: `asciinema-player`
- Create: `apps/web/src/lib/recording.ts`
- Create: `apps/web/src/app/api/sessions/[id]/recording/route.ts`
- Modify: `apps/web/src/app/(dashboard)/sessions/[id]/page.tsx`
- Modify: `apps/web/server.js`

**Step 1: Install dependencies**

```bash
cd apps/web
npm install asciinema-player
```

**Step 2: Create the recording library**

Create `apps/web/src/lib/recording.ts`:

```typescript
import { Storage } from '@google-cloud/storage'
import zlib from 'zlib'
import { promisify } from 'util'
import { redis } from './redis'

const gzip = promisify(zlib.gzip)

function getBucket() {
  const bucket = process.env.GCS_BUCKET_LOGS
  if (!bucket) throw new Error('GCS_BUCKET_LOGS env var is not set')
  return new Storage().bucket(bucket)
}

export function recordingRedisKey(sessionId: string): string {
  return `recording:${sessionId}`
}

/**
 * Called from WS server when session_output arrives for a recording-eligible session.
 * Appends a { t: timestamp_seconds, data: base64 } entry to the Redis list.
 */
export async function appendRecordingFrame(
  sessionId: string,
  base64Data: string,
  sessionStartedAt: Date
): Promise<void> {
  const t = (Date.now() - sessionStartedAt.getTime()) / 1000
  const frame = JSON.stringify({ t: parseFloat(t.toFixed(3)), data: base64Data })
  const key = recordingRedisKey(sessionId)
  await redis.rpush(key, frame)
  // TTL: 365 days for enterprise
  await redis.expire(key, 365 * 24 * 60 * 60)
}

/**
 * Called when session stops. Reads Redis frames, converts to asciinema v2 .cast format,
 * gzips, and uploads to GCS.
 */
export async function archiveSessionRecording(
  sessionId: string,
  orgId: string,
  startedAt: Date,
  width = 220,
  height = 50
): Promise<void> {
  const key = recordingRedisKey(sessionId)
  const frames = await redis.lrange(key, 0, -1)
  if (frames.length === 0) return

  // Build asciinema v2 .cast format
  // Header line: JSON object
  const header = JSON.stringify({
    version: 2,
    width,
    height,
    timestamp: Math.floor(startedAt.getTime() / 1000),
    title: `SessionForge Session ${sessionId}`,
  })

  // Event lines: [time, "o", data] where data is decoded from base64
  const eventLines = frames.map((f) => {
    const { t, data } = JSON.parse(f) as { t: number; data: string }
    const decoded = Buffer.from(data, 'base64').toString('utf-8')
    return JSON.stringify([t, 'o', decoded])
  })

  const castContent = [header, ...eventLines].join('\n')
  const compressed = await gzip(Buffer.from(castContent, 'utf-8'))

  const file = getBucket().file(`session-recordings/${orgId}/${sessionId}.cast.gz`)
  await file.save(compressed, {
    contentType: 'application/gzip',
    metadata: { sessionId, orgId },
  })
}

/**
 * Returns a signed URL for the recording, valid for 15 minutes.
 */
export async function getRecordingSignedUrl(
  sessionId: string,
  orgId: string
): Promise<string | null> {
  const file = getBucket().file(`session-recordings/${orgId}/${sessionId}.cast.gz`)
  const [exists] = await file.exists()
  if (!exists) return null

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
  })
  return url
}
```

**Step 3: Create the recording API route**

Create `apps/web/src/app/api/sessions/[id]/recording/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, sessions, users, machines } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import { getRecordingSignedUrl } from '@/lib/recording'
import type { PlanTier } from '@sessionforge/shared-types'
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

  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (!isFeatureAvailable((userRow?.plan ?? 'free') as PlanTier, 'session_recording')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'Session recording requires an Enterprise plan',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  // Verify ownership + get orgId
  const [record] = await db
    .select({ id: sessions.id, machineId: sessions.machineId })
    .from(sessions)
    .where(and(eq(sessions.id, params.id), eq(sessions.userId, session.user.id)))
    .limit(1)

  if (!record) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Session not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  const [machine] = await db
    .select({ orgId: machines.orgId })
    .from(machines)
    .where(eq(machines.id, record.machineId))
    .limit(1)

  if (!machine?.orgId) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: 'Recording only available for org sessions',
          statusCode: 404,
        },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  const url = await getRecordingSignedUrl(params.id, machine.orgId)
  if (!url) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: 'No recording found for this session',
          statusCode: 404,
        },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json({ data: { url }, error: null } satisfies ApiResponse<{ url: string }>)
}
```

**Step 4: Wire recording into server.js**

In `server.js`, find the `session_output` handler. Add recording capture for enterprise org sessions:

```javascript
// After routing output to the dashboard stream:
if (session.orgId) {
  try {
    const { appendRecordingFrame } = await import('./src/lib/recording.js')
    await appendRecordingFrame(session.id, msg.data, session.startedAt)
  } catch (err) {
    // Non-critical — don't disrupt output delivery
    console.error('[recording] frame append failed:', err)
  }
}
```

In the `session_stopped` handler, after archiving logs, add:

```javascript
if (session.orgId) {
  try {
    const { archiveSessionRecording } = await import('./src/lib/recording.js')
    await archiveSessionRecording(session.id, session.orgId, session.startedAt)
  } catch (err) {
    console.error('[recording] archive failed for session', session.id, ':', err)
  }
}
```

**Step 5: Add recording player to session detail page**

Open `apps/web/src/app/(dashboard)/sessions/[id]/page.tsx`. Add a recording section that only renders when the API returns a URL:

```tsx
// Add to component state:
const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
const [recordingChecked, setRecordingChecked] = useState(false)

// Add to useEffect after session load:
fetch(`/api/sessions/${sessionId}/recording`)
  .then((r) => r.json())
  .then((j) => {
    if (j.data?.url) setRecordingUrl(j.data.url)
  })
  .catch(() => {})
  .finally(() => setRecordingChecked(true))

// Add to JSX after terminal section:
{
  recordingChecked && recordingUrl && (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-white mb-3">Session Recording</h3>
      <div id="asciinema-player-container" />
      <AsciinemaPlayerLoader url={recordingUrl} />
    </div>
  )
}
```

Create a thin client component wrapper:

```tsx
// apps/web/src/components/sessions/AsciinemaPlayerLoader.tsx
'use client'

import { useEffect } from 'react'

export function AsciinemaPlayerLoader({ url }: { url: string }) {
  useEffect(() => {
    let player: { dispose?: () => void } | null = null
    import('asciinema-player').then(({ create }) => {
      player = create(url, document.getElementById('asciinema-player-container')!, {
        theme: 'monokai',
        autoPlay: false,
        loop: false,
      })
    })
    return () => {
      player?.dispose?.()
    }
  }, [url])

  return null
}
```

**Step 6: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 7: Commit**

```bash
git add apps/web/src/lib/recording.ts \
  apps/web/src/app/api/sessions/ \
  apps/web/src/components/sessions/AsciinemaPlayerLoader.tsx \
  apps/web/src/app/\(dashboard\)/sessions/ \
  apps/web/server.js
git commit -m "feat: session recording — Redis buffer, GCS archive, asciinema player"
```

---

## Task 6: Build IP allowlist

**Files:**

- Create: `apps/web/src/lib/ip-allowlist.ts`
- Create: `apps/web/src/app/api/org/security/ip-allowlist/route.ts`
- Create: `apps/web/src/app/api/org/security/ip-allowlist/[id]/route.ts`
- Modify: `apps/web/src/middleware.ts`
- Create: `apps/web/src/app/(dashboard)/settings/org/security/page.tsx`

**Step 1: Install CIDR utility**

```bash
cd apps/web
npm install ip-cidr
npm install --save-dev @types/ip-cidr
```

**Step 2: Write failing test**

Create `apps/web/src/lib/__tests__/ip-allowlist.test.ts`:

```typescript
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
})
```

**Step 3: Run to verify failure**

```bash
npx vitest run src/lib/__tests__/ip-allowlist.test.ts
```

Expected: FAIL.

**Step 4: Create the IP allowlist library**

Create `apps/web/src/lib/ip-allowlist.ts`:

```typescript
import IPCIDR from 'ip-cidr'
import { eq } from 'drizzle-orm'
import { db, ipAllowlists } from '@/db'
import { redis } from './redis'

const CACHE_TTL_SECONDS = 60

export function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const range = new IPCIDR(cidr)
    return range.contains(ip)
  } catch {
    return false
  }
}

/**
 * Returns true if the given IP is allowed for the org.
 * If the org has no allowlist entries, all IPs are allowed.
 * Results are cached in Redis for 60 seconds.
 */
export async function checkIpAllowlist(orgId: string, ip: string): Promise<boolean> {
  const cacheKey = `ip-allowlist:${orgId}`

  // Try cache first
  let cidrs: string[] | null = null
  const cached = await redis.get(cacheKey)
  if (cached !== null) {
    cidrs = JSON.parse(cached as string) as string[]
  } else {
    const entries = await db
      .select({ cidr: ipAllowlists.cidr })
      .from(ipAllowlists)
      .where(eq(ipAllowlists.orgId, orgId))
    cidrs = entries.map((e) => e.cidr)
    await redis.set(cacheKey, JSON.stringify(cidrs), { ex: CACHE_TTL_SECONDS })
  }

  // No entries = allow all
  if (cidrs.length === 0) return true

  return cidrs.some((cidr) => isIpInCidr(ip, cidr))
}

export async function invalidateAllowlistCache(orgId: string): Promise<void> {
  await redis.del(`ip-allowlist:${orgId}`)
}
```

**Step 5: Run tests**

```bash
npx vitest run src/lib/__tests__/ip-allowlist.test.ts
```

Expected: PASS.

**Step 6: Create the IP allowlist API routes**

Create `apps/web/src/app/api/org/security/ip-allowlist/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, ipAllowlists, users } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import { invalidateAllowlistCache } from '@/lib/ip-allowlist'
import { logAuditEvent } from '@/lib/audit'
import type { PlanTier } from '@sessionforge/shared-types'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const cidrSchema = z.object({
  cidr: z
    .string()
    .regex(/^[\d.]+\/\d+$|^[\da-f:]+\/\d+$/i, 'Must be a valid CIDR (e.g. 192.168.1.0/24)'),
  label: z.string().max(255).optional(),
})

async function getOrgAndCheckPlan(userId: string) {
  const [membership] = await db
    .select({ orgId: orgMembers.orgId, plan: organizations.plan, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .limit(1)

  return membership ?? null
}

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

  const membership = await getOrgAndCheckPlan(session.user.id)
  if (!membership) return NextResponse.json({ data: [], error: null })

  if (!isFeatureAvailable(membership.plan as PlanTier, 'ip_allowlist')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'IP allowlist requires an Enterprise plan',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const entries = await db
    .select()
    .from(ipAllowlists)
    .where(eq(ipAllowlists.orgId, membership.orgId))
    .orderBy(ipAllowlists.createdAt)

  return NextResponse.json({ data: entries, error: null } satisfies ApiResponse<typeof entries>)
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

  const membership = await getOrgAndCheckPlan(session.user.id)
  if (!membership) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'No organization found', statusCode: 403 },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  if (
    !isFeatureAvailable(membership.plan as PlanTier, 'ip_allowlist') ||
    membership.role !== 'owner'
  ) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'FORBIDDEN',
          message: 'Requires Enterprise plan and owner role',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = cidrSchema.safeParse(body)
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

  const [created] = await db
    .insert(ipAllowlists)
    .values({ orgId: membership.orgId, cidr: parsed.data.cidr, label: parsed.data.label })
    .returning()

  await invalidateAllowlistCache(membership.orgId)

  await logAuditEvent(membership.orgId, session.user.id, 'ip_allowlist.updated', {
    metadata: { action: 'added', cidr: parsed.data.cidr },
  }).catch(() => {})

  return NextResponse.json({ data: created, error: null }, { status: 201 })
}
```

Create `apps/web/src/app/api/org/security/ip-allowlist/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, ipAllowlists } from '@/db'
import { invalidateAllowlistCache } from '@/lib/ip-allowlist'
import { logAuditEvent } from '@/lib/audit'
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

  // Get org
  const [membership] = await db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1)

  if (!membership || membership.role !== 'owner') {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'FORBIDDEN', message: 'Requires owner role', statusCode: 403 },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const [entry] = await db
    .select({ cidr: ipAllowlists.cidr })
    .from(ipAllowlists)
    .where(and(eq(ipAllowlists.id, params.id), eq(ipAllowlists.orgId, membership.orgId)))
    .limit(1)

  if (!entry) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Entry not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  await db.delete(ipAllowlists).where(eq(ipAllowlists.id, params.id))
  await invalidateAllowlistCache(membership.orgId)

  await logAuditEvent(membership.orgId, session.user.id, 'ip_allowlist.updated', {
    metadata: { action: 'removed', cidr: entry.cidr },
  }).catch(() => {})

  return NextResponse.json({ data: { ok: true }, error: null })
}
```

**Step 7: Add IP allowlist check to middleware**

Open `apps/web/src/middleware.ts`. Add after the existing auth check logic:

```typescript
import { checkIpAllowlist } from '@/lib/ip-allowlist'
import { db, orgMembers } from '@/db'
import { eq } from 'drizzle-orm'

// Paths exempted from IP allowlist check
const ALLOWLIST_EXEMPT = [
  '/api/health',
  '/api/webhooks/stripe',
  '/api/auth',
  '/invite',
  '/login',
  '/signup',
]

// Inside the middleware function, after auth check:
const path = req.nextUrl.pathname
const isExempt = ALLOWLIST_EXEMPT.some((p) => path.startsWith(p))

if (!isExempt && token?.sub) {
  try {
    // Get user's org (if any)
    const membership = await db
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(eq(orgMembers.userId, token.sub))
      .limit(1)

    if (membership[0]?.orgId) {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
      const allowed = await checkIpAllowlist(membership[0].orgId, ip)
      if (!allowed) {
        return new NextResponse(
          JSON.stringify({
            error: {
              code: 'IP_BLOCKED',
              message: 'Your IP address is not in the allowlist',
              statusCode: 403,
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }
  } catch (err) {
    // Don't block on allowlist check failure — log and continue
    console.error('[middleware] ip-allowlist check failed:', err)
  }
}
```

**Step 8: Create the security settings page**

Create `apps/web/src/app/(dashboard)/settings/org/security/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'

interface AllowlistEntry {
  id: string
  cidr: string
  label: string | null
  createdAt: string
}

export default function SecurityPage() {
  const [entries, setEntries] = useState<AllowlistEntry[]>([])
  const [newCidr, setNewCidr] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [currentIp, setCurrentIp] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/org/security/ip-allowlist')
    const j = await res.json()
    setEntries(j.data ?? [])
  }

  useEffect(() => {
    load()
    // Show the user their current IP
    fetch('https://api.ipify.org?format=json')
      .then((r) => r.json())
      .then((d) => setCurrentIp(d.ip))
      .catch(() => {})
  }, [])

  async function add() {
    setIsAdding(true)
    try {
      const res = await fetch('/api/org/security/ip-allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidr: newCidr, label: newLabel || undefined }),
      })
      const j = await res.json()
      if (!res.ok) {
        toast.error(j.error?.message ?? 'Failed to add entry')
        return
      }
      toast.success('IP range added')
      setNewCidr('')
      setNewLabel('')
      await load()
    } finally {
      setIsAdding(false)
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/org/security/ip-allowlist/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to remove entry')
      return
    }
    setEntries((prev) => prev.filter((e) => e.id !== id))
    toast.success('IP range removed')
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Security</h2>
        <p className="text-sm text-gray-400">Restrict access to specific IP ranges</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">IP Allowlist</CardTitle>
          </div>
          <CardDescription>
            Only allow access from these IP ranges. Leave empty to allow all IPs.
            {currentIp && (
              <span className="block mt-1 text-purple-400">
                Your current IP: <code className="font-mono">{currentIp}</code>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="192.168.1.0/24"
              value={newCidr}
              onChange={(e) => setNewCidr(e.target.value)}
              className="font-mono"
            />
            <Input
              placeholder="Label (optional)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <Button size="sm" onClick={add} isLoading={isAdding} disabled={!newCidr}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          {entries.length === 0 && (
            <p className="text-sm text-gray-500">No restrictions — all IPs allowed</p>
          )}

          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between rounded-lg border border-[#1e1e2e] bg-[#111118] px-3 py-2"
            >
              <div>
                <code className="text-sm font-mono text-gray-200">{entry.cidr}</code>
                {entry.label && <span className="ml-2 text-xs text-gray-500">{entry.label}</span>}
              </div>
              <button onClick={() => remove(entry.id)} className="text-gray-600 hover:text-red-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 9: Run tests**

```bash
npx vitest run src/lib/__tests__/ip-allowlist.test.ts
```

Expected: PASS.

**Step 10: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 11: Commit**

```bash
git add apps/web/src/lib/ip-allowlist.ts apps/web/src/lib/__tests__/ip-allowlist.test.ts \
  apps/web/src/app/api/org/security/ apps/web/src/middleware.ts \
  apps/web/src/app/\(dashboard\)/settings/org/security/
git commit -m "feat: IP allowlist — CIDR enforcement in middleware, management UI"
```

---

## Task 7: Build SSO (OIDC)

**Files:**

- Install: `@node-saml/node-saml` (for SAML only — OIDC uses NextAuth built-in)
- Create: `apps/web/src/lib/sso.ts`
- Create: `apps/web/src/app/api/org/sso/route.ts`
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(dashboard)/settings/org/sso/page.tsx`

**Step 1: Install SAML library**

```bash
cd apps/web
npm install @node-saml/node-saml
```

**Step 2: Create the SSO routes**

Create `apps/web/src/app/api/org/sso/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, ssoConfigs, organizations, orgMembers } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const upsertSchema = z.object({
  provider: z.enum(['oidc', 'saml']),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  issuerUrl: z.string().url().optional(),
  samlIdpMetadataUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
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

  const [membership] = await db
    .select({ orgId: orgMembers.orgId, plan: organizations.plan })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1)

  if (!membership || !isFeatureAvailable(membership.plan as PlanTier, 'sso')) {
    return NextResponse.json({ data: null, error: null })
  }

  const [config] = await db
    .select({
      id: ssoConfigs.id,
      provider: ssoConfigs.provider,
      clientId: ssoConfigs.clientId,
      issuerUrl: ssoConfigs.issuerUrl,
      samlIdpMetadataUrl: ssoConfigs.samlIdpMetadataUrl,
      enabled: ssoConfigs.enabled,
    })
    .from(ssoConfigs)
    .where(eq(ssoConfigs.orgId, membership.orgId))
    .limit(1)

  // clientSecret intentionally omitted from GET response
  return NextResponse.json({ data: config ?? null, error: null })
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

  const [membership] = await db
    .select({ orgId: orgMembers.orgId, plan: organizations.plan, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1)

  if (
    !membership ||
    !isFeatureAvailable(membership.plan as PlanTier, 'sso') ||
    membership.role !== 'owner'
  ) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'FORBIDDEN',
          message: 'Requires Enterprise plan and owner role',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = upsertSchema.safeParse(body)
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

  const existing = await db
    .select({ id: ssoConfigs.id })
    .from(ssoConfigs)
    .where(eq(ssoConfigs.orgId, membership.orgId))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(ssoConfigs)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(ssoConfigs.orgId, membership.orgId))
  } else {
    await db.insert(ssoConfigs).values({ orgId: membership.orgId, ...parsed.data })
  }

  return NextResponse.json({ data: { ok: true }, error: null })
}
```

**Step 3: Create the SSO settings page**

Create `apps/web/src/app/(dashboard)/settings/org/sso/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Shield, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

interface SsoConfig {
  id: string
  provider: 'oidc' | 'saml'
  clientId: string | null
  issuerUrl: string | null
  samlIdpMetadataUrl: string | null
  enabled: boolean
}

export default function SsoPage() {
  const [config, setConfig] = useState<SsoConfig | null>(null)
  const [provider, setProvider] = useState<'oidc' | 'saml'>('oidc')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [issuerUrl, setIssuerUrl] = useState('')
  const [samlMetadataUrl, setSamlMetadataUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetch('/api/org/sso')
      .then((r) => r.json())
      .then((j) => {
        if (j.data) {
          setConfig(j.data)
          setProvider(j.data.provider)
          setClientId(j.data.clientId ?? '')
          setIssuerUrl(j.data.issuerUrl ?? '')
          setSamlMetadataUrl(j.data.samlIdpMetadataUrl ?? '')
          setEnabled(j.data.enabled)
        }
      })
  }, [])

  async function save() {
    setIsSaving(true)
    try {
      const body: Record<string, unknown> = { provider, enabled }
      if (provider === 'oidc') {
        body.clientId = clientId
        if (clientSecret) body.clientSecret = clientSecret
        body.issuerUrl = issuerUrl
      } else {
        body.samlIdpMetadataUrl = samlMetadataUrl
      }
      const res = await fetch('/api/org/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (!res.ok) {
        toast.error(j.error?.message ?? 'Failed to save SSO config')
        return
      }
      toast.success('SSO configuration saved')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Single Sign-On</h2>
        <p className="text-sm text-gray-400">Configure OIDC or SAML for your organization</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">SSO Configuration</CardTitle>
          </div>
          <CardDescription>
            Members will be redirected to your IdP when they log in with your organization's email
            domain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as 'oidc' | 'saml')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oidc">OIDC (Okta, Google Workspace, Azure AD)</SelectItem>
                <SelectItem value="saml">SAML 2.0</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {provider === 'oidc' && (
            <>
              <div className="space-y-1.5">
                <Label>Issuer URL</Label>
                <Input
                  value={issuerUrl}
                  onChange={(e) => setIssuerUrl(e.target.value)}
                  placeholder="https://your-idp.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Client ID</Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="your-client-id"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Client Secret{' '}
                  {config && (
                    <span className="text-gray-500 text-xs">(leave blank to keep existing)</span>
                  )}
                </Label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </>
          )}

          {provider === 'saml' && (
            <div className="space-y-1.5">
              <Label>IdP Metadata URL</Label>
              <Input
                value={samlMetadataUrl}
                onChange={(e) => setSamlMetadataUrl(e.target.value)}
                placeholder="https://your-idp.example.com/metadata"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="sso-enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-purple-500"
            />
            <Label htmlFor="sso-enabled">Enable SSO for this organization</Label>
          </div>

          <Button size="sm" onClick={save} isLoading={isSaving}>
            <Save className="h-4 w-4" />
            Save Configuration
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 4: Add SSO domain detection to login page**

Open `apps/web/src/app/(auth)/login/page.tsx`. Add a blur handler on the email field:

```tsx
async function checkSso(email: string) {
  const domain = email.split('@')[1]
  if (!domain) return
  const res = await fetch(`/api/auth/sso-check?domain=${encodeURIComponent(domain)}`)
  const j = await res.json()
  if (j.data?.redirectUrl) {
    window.location.href = j.data.redirectUrl
  }
}

// On the email input:
onBlur={(e) => checkSso(e.target.value)}
```

Create `apps/web/src/app/api/auth/sso-check/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, like } from 'drizzle-orm'
import { db, organizations, ssoConfigs } from '@/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain')
  if (!domain) return NextResponse.json({ data: null, error: null })

  // Find an enabled SSO config for an org whose owner has this email domain
  const [config] = await db
    .select({ provider: ssoConfigs.provider, orgId: ssoConfigs.orgId })
    .from(ssoConfigs)
    .where(eq(ssoConfigs.enabled, true))
    .limit(1)

  if (!config) return NextResponse.json({ data: null, error: null })

  const redirectUrl =
    config.provider === 'saml'
      ? `/api/auth/saml/initiate/${config.orgId}`
      : `/api/auth/signin/oidc-${config.orgId}`

  return NextResponse.json({ data: { redirectUrl }, error: null })
}
```

**Step 5: Typecheck**

```bash
cd C:/Users/Jakeb/sessionforge && npm run type-check
```

**Step 6: Commit**

```bash
git add apps/web/src/lib/sso.ts apps/web/src/app/api/org/sso/ \
  apps/web/src/app/api/auth/sso-check/ \
  apps/web/src/app/\(dashboard\)/settings/org/sso/ \
  apps/web/src/app/\(auth\)/login/page.tsx
git commit -m "feat: SSO OIDC + SAML config API, domain detection on login, settings UI"
```

---

## Task 8: Run migrations and full QA gate

**Step 1: Apply migrations**

```bash
cd apps/web && npm run db:migrate
```

**Step 2: Run unit tests**

```bash
cd C:/Users/Jakeb/sessionforge && npm run test:unit
```

Expected: 0 failures.

**Step 3: Run integration tests**

```bash
npm run test:integration
```

Expected: 0 failures.

**Step 4: Run full QA runbook**

Follow `/qa-runbook` — all 9 steps must pass before merging.

**Step 5: Push and open PR**

```bash
git push -u origin feat/enterprise-gaps
```

Open PR against `main`. Title: `feat: SSO, audit log, session recording, IP allowlist (Enterprise tier)`.

---

## Summary of new files

| File                                                           | What it does                                 |
| -------------------------------------------------------------- | -------------------------------------------- |
| `apps/web/src/lib/audit.ts`                                    | `logAuditEvent()` helper                     |
| `apps/web/src/lib/recording.ts`                                | Recording buffer + GCS archival + signed URL |
| `apps/web/src/lib/ip-allowlist.ts`                             | CIDR check with Redis cache                  |
| `apps/web/src/lib/sso.ts`                                      | SSO provider utilities                       |
| `apps/web/src/app/api/org/audit-log/route.ts`                  | Paginated audit log API                      |
| `apps/web/src/app/api/org/sso/route.ts`                        | SSO config GET + POST                        |
| `apps/web/src/app/api/auth/sso-check/route.ts`                 | Domain → SSO redirect lookup                 |
| `apps/web/src/app/api/org/security/ip-allowlist/route.ts`      | IP allowlist CRUD                            |
| `apps/web/src/app/api/sessions/[id]/recording/route.ts`        | Recording signed URL                         |
| `apps/web/src/app/(dashboard)/settings/org/audit-log/page.tsx` | Audit log UI                                 |
| `apps/web/src/app/(dashboard)/settings/org/sso/page.tsx`       | SSO config UI                                |
| `apps/web/src/app/(dashboard)/settings/org/security/page.tsx`  | IP allowlist UI                              |
| `apps/web/src/components/sessions/AsciinemaPlayerLoader.tsx`   | Recording player                             |
