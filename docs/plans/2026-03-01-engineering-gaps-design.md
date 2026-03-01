# Engineering Gaps Design

**Date:** 2026-03-01
**Status:** Approved
**Approach:** Option C — Feature branch per tier (core → pro/team → enterprise)

---

## Problem

A full codebase audit identified gaps across all plan tiers where features are either
stubbed, feature-flagged with no implementation, or visually present with no backend.
These gaps must be closed before continuing new feature development.

---

## Branch Strategy

| Branch                 | Tier       | Deploys independently |
| ---------------------- | ---------- | --------------------- |
| `feat/core-gaps`       | All users  | Yes                   |
| `feat/pro-team-gaps`   | Pro + Team | Yes — after core      |
| `feat/enterprise-gaps` | Enterprise | Yes — after pro/team  |

Each branch is gated by the full QA runbook before merge.

---

## Branch 1: `feat/core-gaps` — All Tiers

### 1a. xterm.js installation

**Problem:** Terminal component has full xterm.js wiring but the packages are missing from `apps/web/package.json`, so it always falls back to the stub.

**Fix:** Add to `apps/web/package.json`:

- `@xterm/xterm`
- `@xterm/addon-fit`
- `@xterm/addon-web-links`

No code changes required — `Terminal.tsx` already imports and uses all three via dynamic import with fallback.

**Files:**

- `apps/web/package.json`

---

### 1b. Notification preferences — DB persistence

**Problem:** Settings page renders 4 notification toggles but `Save Preferences` has no handler, no API route, and no DB column.

**Design:**

- Add `notificationPreferences` JSONB column to `users` table (nullable, default null = all defaults)
- Schema: `{ sessionCrashed: boolean, machineOffline: boolean, sessionStarted: boolean, weeklyDigest: boolean }`
- New `PATCH /api/user/notifications` route — auth required, validates with Zod, writes to DB
- New `GET /api/user/notifications` route — returns current prefs or defaults if null
- Settings page: load prefs on mount, wire Save button to `PATCH`

**Files:**

- `apps/web/src/db/schema/index.ts` — add `notificationPreferences` column
- `apps/web/src/db/migrations/` — new migration
- `apps/web/src/app/api/user/notifications/route.ts` — new
- `apps/web/src/app/(dashboard)/settings/page.tsx` — wire GET + PATCH

---

### 1c. Notification panel (bell icon)

**Problem:** Header bell icon renders with a permanent purple dot. Clicking it does nothing.

**Design:**

- New `notifications` table: `id`, `userId`, `type` (`session_crashed` | `machine_offline`), `title`, `body`, `readAt` (nullable), `resourceId`, `createdAt`
- New `GET /api/notifications` — returns unread + last 20 total, sorted by `createdAt` desc
- New `POST /api/notifications/[id]/read` — marks one as read
- New `POST /api/notifications/read-all` — marks all as read
- Server-side writers: call `createNotification(userId, type, title, body, resourceId)` inside:
  - WS handler when `session_crashed` message received from agent
  - WS handler when machine goes offline (heartbeat timeout)
- Header bell: shadcn `Sheet` (slide-out panel), opens on click, shows notification list
- Bell dot: visible only when `GET /api/notifications` returns `unreadCount > 0`

**Files:**

- `apps/web/src/db/schema/index.ts` — add `notifications` table
- `apps/web/src/db/migrations/` — new migration
- `apps/web/src/app/api/notifications/route.ts` — new
- `apps/web/src/app/api/notifications/[id]/read/route.ts` — new
- `apps/web/src/app/api/notifications/read-all/route.ts` — new
- `apps/web/src/lib/notifications.ts` — `createNotification()` helper
- `apps/web/src/components/layout/NotificationsPanel.tsx` — new Sheet component
- `apps/web/src/components/layout/Header.tsx` — wire bell to panel + unread count
- `apps/web/server.js` — call `createNotification()` on crash/offline events

---

### 1d. Delete Account

**Problem:** Danger Zone has a `Delete Account` button with no handler.

**Design:**

- New `DELETE /api/user` route:
  1. Auth required
  2. If `users.stripeCustomerId` is set → cancel Stripe subscription via `stripe.subscriptions.cancel()`
  3. Delete user row — all related rows cascade (machines, sessions, api_keys, org_members, auth_sessions)
  4. If user is sole org owner → delete the organization (check `org_members` for other owners first; if none, cascade delete org)
  5. Return `{ ok: true }`
- Settings page: confirmation dialog (shadcn `AlertDialog`) — user must type their email to confirm
- On success: `signOut({ callbackUrl: '/' })`

**Failure handling:** If Stripe cancel fails, log error but continue deletion — user data must be removed regardless.

**Files:**

- `apps/web/src/app/api/user/route.ts` — add `DELETE` handler
- `apps/web/src/app/(dashboard)/settings/page.tsx` — confirmation dialog + DELETE call

---

## Branch 2: `feat/pro-team-gaps` — Pro + Team Tiers

### 2a. Webhook delivery system (Pro+)

**New tables:**

```
webhooks
  id uuid PK
  userId uuid FK users
  orgId uuid FK organizations (nullable)
  url varchar(2048) NOT NULL
  secret varchar(64) NOT NULL  -- HMAC signing key, shown once on creation
  events text[] NOT NULL       -- e.g. ['session.started', 'session.crashed']
  enabled boolean NOT NULL DEFAULT true
  createdAt timestamp

webhook_deliveries
  id uuid PK
  webhookId uuid FK webhooks
  event varchar(64) NOT NULL
  payload jsonb NOT NULL
  status varchar(16) NOT NULL  -- 'pending' | 'delivered' | 'failed'
  responseCode integer
  responseBody text
  attempts integer NOT NULL DEFAULT 0
  lastAttemptAt timestamp
  createdAt timestamp
```

**API routes:**

- `POST /api/webhooks` — create (Pro+ gate via `isFeatureAvailable('webhooks')`)
- `GET /api/webhooks` — list for authenticated user/org
- `DELETE /api/webhooks/[id]` — remove (owner only)
- `GET /api/webhooks/[id]/deliveries` — delivery history for debugging

**Delivery worker:**

- `apps/web/src/lib/webhook-delivery.ts` — `deliverWebhook(event, payload, userId)` function
- Finds all enabled webhooks for the user/org that subscribe to the event
- Signs payload: `X-SessionForge-Signature: sha256=<hmac>`
- POSTs to webhook URL with 10s timeout
- On failure: increments `attempts`, sets `lastAttemptAt`, schedules retry (3 attempts: 1min, 5min, 30min) via Upstash Redis delayed queue
- Called from: WS handler on `session_started`, `session_stopped`, `session_crashed`; machine status change handler

**UI:**

- New `/webhooks` page — list endpoints, create dialog, delivery log per endpoint
- Sidebar entry visible only when `isFeatureAvailable('webhooks')`

**Files:**

- `apps/web/src/db/schema/index.ts`
- `apps/web/src/db/migrations/`
- `apps/web/src/app/api/webhooks/route.ts`
- `apps/web/src/app/api/webhooks/[id]/route.ts`
- `apps/web/src/app/api/webhooks/[id]/deliveries/route.ts`
- `apps/web/src/lib/webhook-delivery.ts`
- `apps/web/src/app/(dashboard)/webhooks/page.tsx`
- `apps/web/src/components/layout/Sidebar.tsx` — add Webhooks link

---

### 2b. Session log archival — GCS (Pro+: 30 days, Team: 90 days, Enterprise: 365 days)

**Design:**

- On session stop (WS `session_stopped` handler): call `archiveSessionLogs(sessionId, userId)`
  - Reads full Redis ring buffer (`LRANGE session:logs:{id} 0 -1`)
  - Gzips and writes to GCS: `session-logs/{userId}/{sessionId}.ndjson.gz`
  - Does NOT delete Redis key (TTL handles it)
- `GET /api/sessions/[id]/logs`:
  - If Redis has data → return from Redis (source: `redis`)
  - If Redis empty + session is stopped → fetch from GCS (source: `gcs`)
  - Enforce `historyDays` gate: if `(now - session.stoppedAt).days > PLAN_LIMITS[plan].historyDays` → 403 with `{ code: 'HISTORY_LIMIT', upgradeUrl: '/settings/org' }`
- New env var: `GCS_BUCKET_LOGS` (same service account already has GCS access via Cloud Run)

**Files:**

- `apps/web/src/lib/gcs-logs.ts` — `archiveSessionLogs()` + `fetchLogsFromGCS()` helpers
- `apps/web/src/app/api/sessions/[id]/logs/route.ts` — implement GCS fallback + history gate
- `apps/web/server.js` — call `archiveSessionLogs()` on `session_stopped`

---

### 2c. RBAC on org routes (Team+)

**Design:**

- New helper: `apps/web/src/lib/org-auth.ts` — `requireOrgRole(session, orgId, minRole: MemberRole)`
  - Reads `org_members` for the user+org pair
  - Throws 403 if user is not a member or role is below `minRole`
  - Role order: `viewer < member < admin < owner`
- Apply to existing routes:
  - `POST /api/org/members` — requires `admin`
  - `DELETE /api/org/invites/[token]` — requires `admin`
  - `PATCH /api/org` — requires `owner`
  - Machine create within org context — requires `member`
- Session start/stop on org machines:
  - `viewer` role → 403 on `POST /api/sessions` targeting an org machine
  - `member`+ → allowed per plan limits

**Files:**

- `apps/web/src/lib/org-auth.ts` — new
- `apps/web/src/app/api/org/members/route.ts`
- `apps/web/src/app/api/org/invites/[token]/route.ts`
- `apps/web/src/app/api/org/route.ts`
- `apps/web/src/app/api/machines/route.ts`
- `apps/web/src/app/api/sessions/route.ts`

---

## Branch 3: `feat/enterprise-gaps` — Enterprise Tier Only

### 3a. SSO (OIDC + SAML)

**New table:**

```
sso_configs
  id uuid PK
  orgId uuid FK organizations UNIQUE
  provider varchar(16)  -- 'oidc' | 'saml'
  clientId text
  clientSecret text  -- AES-256-GCM encrypted via GCP KMS key
  issuerUrl text
  samlIdpMetadataUrl text  -- SAML only
  enabled boolean DEFAULT false
  createdAt timestamp
  updatedAt timestamp
```

**Design:**

- OIDC: configure NextAuth custom provider dynamically from `sso_configs` at login time
- SAML: `@node-saml/node-saml` — SP-initiated, ACS at `/api/auth/saml/callback/[orgId]`
- Login page: email field → on blur, check if email domain matches any `sso_configs` org → redirect to IdP
- `GET /api/org/sso` — return config (clientSecret redacted)
- `POST /api/org/sso` — create/update config (owner only, enterprise gate)
- `POST /api/org/sso/test` — test IdP connectivity, return success/error
- New `/settings/org/sso` page

**Failure handling:** If SSO is misconfigured, fall back to password auth and write audit log entry `sso.fallback`.

**Files:**

- `apps/web/src/db/schema/index.ts`
- `apps/web/src/db/migrations/`
- `apps/web/src/app/api/org/sso/route.ts` — new
- `apps/web/src/app/api/auth/saml/callback/[orgId]/route.ts` — new
- `apps/web/src/lib/sso.ts` — dynamic provider builder
- `apps/web/src/app/(auth)/login/page.tsx` — domain detection + SSO redirect
- `apps/web/src/app/(dashboard)/settings/org/sso/page.tsx` — new

---

### 3b. Audit Log

**New table:**

```
audit_logs
  id uuid PK
  orgId uuid FK organizations NOT NULL
  userId uuid FK users (nullable — system events)
  action varchar(64) NOT NULL
  targetId varchar(255)  -- ID of affected resource
  metadata jsonb
  ip varchar(45)
  createdAt timestamp
```

**Actions:** `member.invited`, `member.removed`, `session.started`, `session.stopped`, `machine.added`, `machine.deleted`, `sso.login`, `sso.fallback`, `api_key.created`, `api_key.deleted`, `plan.changed`, `ip_allowlist.updated`

**Design:**

- `apps/web/src/lib/audit.ts` — `logAuditEvent(orgId, userId, action, targetId?, metadata?, ip?)` helper
- Called inline in existing API routes (not async side-effect — must be awaited so failures are visible)
- `GET /api/org/audit-log` — paginated (50/page), filterable by `action`, `userId`, `startDate`, `endDate` (enterprise gate)
- Response includes actor name/email joined from `users`
- `/settings/org/audit-log` page — table with filters + `Export CSV` button

**Files:**

- `apps/web/src/db/schema/index.ts`
- `apps/web/src/db/migrations/`
- `apps/web/src/lib/audit.ts` — new
- `apps/web/src/app/api/org/audit-log/route.ts` — new
- `apps/web/src/app/(dashboard)/settings/org/audit-log/page.tsx` — new
- All org API routes — add `logAuditEvent()` calls

---

### 3c. Session Recording

**Design:**

- WS handler intercepts `session_output` messages → appends raw base64 chunk + timestamp to Redis list `recording:{sessionId}`
- Recording TTL: same as `historyDays` for enterprise (365 days) — set via `EXPIRE`
- On session stop: `archiveSessionRecording(sessionId, orgId)` — reads Redis list, converts to ascentcast v2 `.cast` JSON format, gzips, uploads to GCS `session-recordings/{orgId}/{sessionId}.cast.gz`
- `GET /api/sessions/[id]/recording` — returns `{ url: <signed GCS URL, 15min TTL> }` (enterprise gate)
- Session detail page (`/sessions/[id]`): if recording exists, render `<AsciinemaPlayer>` component using the signed URL

**Dependencies:**

- `asciinema-player` — React wrapper for the asciinema web player

**Files:**

- `apps/web/src/lib/recording.ts` — `archiveSessionRecording()` + ascentcast formatter
- `apps/web/src/app/api/sessions/[id]/recording/route.ts` — new
- `apps/web/src/app/(dashboard)/sessions/[id]/page.tsx` — embed player
- `apps/web/server.js` — intercept `session_output` for recording, call `archiveSessionRecording()`

---

### 3d. IP Allowlist

**New table:**

```
ip_allowlists
  id uuid PK
  orgId uuid FK organizations
  cidr varchar(43) NOT NULL  -- e.g. '192.168.1.0/24' or '10.0.0.1/32'
  label varchar(255)
  createdAt timestamp
```

**Design:**

- `apps/web/src/lib/ip-allowlist.ts` — `checkIpAllowlist(orgId, ip)` — loads CIDR list from DB (cached 60s in Redis), returns `allowed: boolean`
- Middleware (`apps/web/src/middleware.ts`): for authenticated requests on `/api/*` and `/(dashboard)/*`, if org has allowlist entries → call `checkIpAllowlist()`; deny with 403 if not allowed
- Exempted paths: `/api/health`, `/api/webhooks/stripe`, `/api/auth/*`, `/invite/*`
- `POST /api/org/security/ip-allowlist` — add CIDR (owner only, enterprise gate)
- `DELETE /api/org/security/ip-allowlist/[id]` — remove
- `GET /api/org/security/ip-allowlist` — list
- `/settings/org/security` page — manage CIDRs, show current IP, test button

**Files:**

- `apps/web/src/db/schema/index.ts`
- `apps/web/src/db/migrations/`
- `apps/web/src/lib/ip-allowlist.ts` — new
- `apps/web/src/middleware.ts` — add allowlist check
- `apps/web/src/app/api/org/security/ip-allowlist/route.ts` — new
- `apps/web/src/app/api/org/security/ip-allowlist/[id]/route.ts` — new
- `apps/web/src/app/(dashboard)/settings/org/security/page.tsx` — new

---

## QA Coverage per Branch

### `feat/core-gaps`

| Test                                                | Skill                  |
| --------------------------------------------------- | ---------------------- |
| xterm.js renders, connects, sends input             | `qa-ux-flows`          |
| Notification prefs persist to DB                    | `api-contract-checker` |
| Bell panel shows unread on crash/offline            | `qa-ux-flows`          |
| Delete account clears all data, session invalidated | `qa-auth-validator`    |

### `feat/pro-team-gaps`

| Test                                      | Skill                  |
| ----------------------------------------- | ---------------------- |
| Webhook created + HMAC-signed delivery    | `api-contract-checker` |
| Webhook delivery retries under load       | `qa-performance`       |
| GCS log archival + retrieval              | `api-contract-checker` |
| Viewer role blocked from starting session | `qa-auth-validator`    |
| Free plan blocked from creating webhook   | `api-contract-checker` |

### `feat/enterprise-gaps`

| Test                                           | Skill                  |
| ---------------------------------------------- | ---------------------- |
| SSO login redirects to configured IdP          | `qa-ux-flows`          |
| Audit log entry written on key actions         | `api-contract-checker` |
| Session recording playable after session stops | `qa-ux-flows`          |
| IP allowlist blocks disallowed IP              | `qa-security`          |

---

## Out of Scope

- SAML IdP-initiated flow (SP-initiated only)
- Webhook UI for delivery retry (manual retry — future sprint)
- Session recording download (streaming playback only)
- Enterprise custom branding (feature-flagged, post-launch)
- Multi-region GCS replication
