# SessionForge — Production Launch Master Plan

> **Status:** ACTIVE — execute in parallel across agents
> **Owner:** Perry Bailes / Support Forge LLC
> **Target:** Production launch within 1 week
> **Last updated:** 2026-03-14

---

## OVERRIDING ENGINEERING PRINCIPLES

- Simplicity First: touch only what needs changing
- No over-engineering: minimum viable implementation for each feature
- Verify before done: build/type-check/test after every task
- Parallel execution: all tracks are independent unless marked with a dependency
- Deploy early, iterate fast

---

## Architecture Snapshot

```
Browser (xterm.js) ←→ Cloud Run (Next.js + server.js WS relay) ←→ Redis ←→ Go Agent (Windows/Mac/Linux)
                                        ↕
                               PostgreSQL (Cloud SQL)
                                        ↕
                              GCS (session recordings)
```

**Key constraint:** The WebSocket relay is already multi-subscriber capable. Redis ring buffer (`session:logs:{sessionId}`) replays on `subscribe_session`. Adopt-a-session requires zero relay changes — only DB flag + UI + auth check.

---

## TRACK A — P0 Launch Blockers (SHIP TODAY)

> Assign to: Agent 1
> Files: `apps/web/server.js`, `agent/internal/connection/client.go`, `agent/internal/cli/run.go`, `apps/web/e2e/dashboard.spec.ts`
> Dependency: None — fully independent

### A1 — Remove debug logs from server.js

**File:** `apps/web/server.js`

Remove these lines (find by content, not line number — file may have shifted):

```javascript
// REMOVE — "RAW ARRIVAL" block:
if (msg.type !== 'heartbeat' && msg.type !== 'pong') {
  console.log('[ws/agent] RAW ARRIVAL type:', msg.type, 'bytes:', raw.length)
}

// REMOVE — only the console.log line, keep the variable if used downstream:
console.log('[ws/agent] session_output publishing sid:', sessionId, 'ownerUserId:', ownerUserId)
```

Verify: `grep -n "RAW ARRIVAL\|session_output publishing" apps/web/server.js` → empty
Verify: `node --check apps/web/server.js` → no errors

- [ ] Remove RAW ARRIVAL console.log block
- [ ] Remove session_output publishing console.log (keep variable if referenced)
- [ ] Verify grep returns empty
- [ ] Verify node --check passes

### A2 — Downgrade writeLoop logs in client.go

**File:** `agent/internal/connection/client.go`

Change two `.Info(` calls to `.Debug(`:

- `c.logger.Info("writeLoop: sending"` → `c.logger.Debug("writeLoop: sending"`
- `c.logger.Info("writeLoop: sent ok"` → `c.logger.Debug("writeLoop: sent ok"`

Verify: `cd agent && C:\Users\Jakeb\go\bin\go.exe build ./...` → no errors

- [ ] Change writeLoop: sending to Debug
- [ ] Change writeLoop: sent ok to Debug
- [ ] Build passes

### A3 — Fix garbled output in `sessionforge run`

**File:** `agent/internal/cli/run.go`

Replace `buildLogger` call inside `runRun` with `buildRunLogger`, add the function:

```go
func buildRunLogger(level, logFile string) *slog.Logger {
    var l slog.Level
    switch level {
    case "debug":
        l = slog.LevelDebug
    case "warn":
        l = slog.LevelWarn
    default:
        l = slog.LevelError
    }

    var w io.Writer = io.Discard
    if logFile != "" {
        f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
        if err == nil {
            w = f
            switch level {
            case "debug":
                l = slog.LevelDebug
            case "warn":
                l = slog.LevelWarn
            case "error":
                l = slog.LevelError
            default:
                l = slog.LevelInfo
            }
        }
    }

    return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: l}))
}
```

Add `"io"` to imports if missing.

Verify: `cd agent && C:\Users\Jakeb\go\bin\go.exe build ./...` → no errors

- [ ] Add buildRunLogger function
- [ ] Replace buildLogger call in runRun
- [ ] Add io import if missing
- [ ] Build passes

### A4 — Add Playwright E2E terminal test

**File:** `apps/web/e2e/dashboard.spec.ts`

Add to the sessions test suite:

```typescript
test('terminal container renders for active session', async ({ page }) => {
  await page.goto('/sessions')
  const activeSession = page.locator('[data-status="running"], [data-status="active"]').first()
  const count = await activeSession.count()
  if (count === 0) {
    test.skip()
    return
  }
  await activeSession.click()
  await expect(
    page.locator('[data-testid="terminal-container"], .xterm, .xterm-screen')
  ).toBeVisible({ timeout: 10000 })
})
```

Find any existing `test.skip(` near "terminal container" and unskip it.

Verify: `cd apps/web && npx tsc --noEmit` → no type errors

- [ ] Add terminal E2E test
- [ ] Unskip any existing terminal skip
- [ ] TypeScript check passes

### A-Deploy — Build agent + deploy web

After A1-A4 complete:

- [ ] Build agent: `cd agent && C:\Users\Jakeb\go\bin\go.exe build -o C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe ./cmd/sessionforge/`
- [ ] Run `gcloud auth login` (Perry to do interactively)
- [ ] Deploy: `gcloud run deploy sessionforge --source . --region us-central1 --allow-unauthenticated`
- [ ] Verify: `curl -s https://sessionforge.dev/api/health`

---

## TRACK B — Adopt Session Phase 1 (SHIP THIS WEEK)

> Assign to: Agent 2
> Dependency: None — all new code, no conflicts with Track A

### Overview

The relay already supports multiple subscribers. A second browser tab subscribing to the same `sessionId` via `subscribe_session` already receives output today. We need:

1. `adoptable` flag on sessions (DB + API)
2. Session detail page: "Share / Adopt" button generates a shareable token
3. Any authenticated org member can connect to an adoptable session
4. Optional: read-only vs read-write mode (default: read-write for team members)

### B1 — DB migration: add adoptable flag

**File:** `apps/web/src/db/migrations/0009_adopt_session.sql`

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS adoptable boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS adopted_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS adopted_at timestamp with time zone;
```

**File:** `apps/web/src/db/schema/index.ts`

Add to sessions table definition:

```typescript
adoptable: boolean('adoptable').notNull().default(false),
adoptedBy: uuid('adopted_by').references(() => users.id),
adoptedAt: timestamp('adopted_at', { withTimezone: true }),
```

- [ ] Write migration SQL file
- [ ] Update schema/index.ts
- [ ] Verify: `cd apps/web && npx tsc --noEmit`

### B2 — API endpoints

**File:** `apps/web/src/app/api/sessions/[id]/adopt/route.ts` (NEW)

```typescript
// POST /api/sessions/:id/adopt — mark session as adoptable, return session info
// DELETE /api/sessions/:id/adopt — revoke adoptable status
// GET /api/sessions/:id/adopt — get adoptable status
```

Rules:

- Session owner OR org admin can toggle adoptable
- Any org member can adopt (connect to) an adoptable session
- Adoption records who adopted + when (for audit trail)
- Session must be status='running' to be adoptable

- [ ] Create adopt/route.ts with POST (mark adoptable), DELETE (revoke), GET (status)
- [ ] Auth checks: owner/admin to mark, any org member to adopt
- [ ] Update session detail GET to include adoptable/adoptedBy fields
- [ ] TypeScript check passes

### B3 — Sessions list: "Adoptable" badge

**File:** `apps/web/src/components/sessions/SessionList.tsx` (or equivalent)

- Add green "Adoptable" badge on session rows where `adoptable === true`
- "Adopt" button on those rows — clicking opens the session terminal
- For session owner: "Share" button on running sessions → toggles adoptable flag with one click

- [ ] Add Adoptable badge to session list row
- [ ] Add Adopt button (navigates to session detail, auto-subscribes)
- [ ] Add Share toggle button for session owner
- [ ] TypeScript check passes

### B4 — Session detail: Adopt UI

**File:** `apps/web/src/app/(dashboard)/sessions/[id]/page.tsx`

- If `adoptable` and user is not the owner: show "You are viewing [owner]'s session" banner
- If user is owner: show "Share this session" toggle (calls POST/DELETE /api/sessions/:id/adopt)
- Terminal connects normally via existing `subscribe_session` WS message
- No relay changes needed — works today

- [ ] Add adoption banner for non-owner viewers
- [ ] Add "Share this session" toggle for owners
- [ ] Verify terminal connects and receives output for adopted session
- [ ] TypeScript check passes

### B5 — Notification: session adopted

**File:** `apps/web/src/app/api/sessions/[id]/adopt/route.ts`

When someone adopts a session, notify the session owner via the existing notifications system:

```
type: 'session_adopted'
title: '[username] joined your session'
body: 'Someone connected to your Claude Code session on [machine name]'
```

Add `session_adopted` to the notification_type enum in schema.

- [ ] Add session_adopted notification type to enum
- [ ] Fire notification when adopt POST is called
- [ ] TypeScript check passes

---

## TRACK C — `/sf-pause` Claude Code Skill (SHIP THIS WEEK)

> Assign to: Agent 3
> Dependency: Track B must be deployed first (needs the adopt API endpoint)

### Overview

A Claude Code slash command installed on the host machine. When the user types `/sf-pause`, Claude:

1. Calls the SessionForge agent's local HTTP API (`localhost:PORT/api/pause`)
2. Agent marks session as adoptable via server API
3. Claude confirms: "Session is now adoptable. Open SessionForge to resume from any device."

### C1 — Agent local HTTP endpoint

**File:** `agent/internal/cli/root.go` or new `agent/internal/httpserver/server.go`

Add a local HTTP server (default port 3457) with one endpoint:

```
POST /api/pause — marks current session(s) as adoptable
  Body: { sessionId?: string } (if empty, marks all running sessions)
  Auth: local only (bind to 127.0.0.1 only)
  Response: { ok: true, adoptableUrl: "https://sessionforge.dev/sessions/{id}" }
```

- [ ] Add local HTTP server binding to 127.0.0.1:3457
- [ ] POST /api/pause endpoint
- [ ] Calls server API to mark session adoptable
- [ ] Returns adoptable URL
- [ ] Build passes

### C2 — Claude Code skill file

**File:** `C:\Users\Jakeb\.claude\skills\sf-pause\SKILL.md` (and distribute to hosts)

```markdown
---
name: sf-pause
description: Pause your SessionForge session and make it adoptable from any device
trigger: /sf-pause
---

You are helping the user pause their work and hand off their Claude Code session
to be accessible remotely via SessionForge.

Steps:

1. Call the SessionForge agent API at http://127.0.0.1:3457/api/pause using a bash tool call
2. If successful, tell the user:
   "Your session is now live and adoptable. Open SessionForge to resume from any device:
   [URL from response]
   Your work will continue running. Close this terminal when ready."
3. If the agent isn't running or the call fails, tell the user:
   "SessionForge agent isn't running. Install it at sessionforge.dev/install"
```

- [ ] Write sf-pause skill file
- [ ] Test: type /sf-pause in Claude Code session with agent running
- [ ] Verify adoptable flag is set via dashboard

### C3 — Installer deploys the skill

**File:** `C:\Users\Jakeb\sessionforge-installer-src\installer.ps1`

In the `Do-Install` function, after writing config.toml:

- Create `$env:USERPROFILE\.claude\skills\sf-pause\` directory
- Write `SKILL.md` to it

This means every host that installs the agent gets the `/sf-pause` skill automatically.

- [ ] Add skill deployment to installer Do-Install function
- [ ] Rebuild installer EXE
- [ ] Copy to USB

---

## TRACK D — "What Is Claude Doing?" AI Summary (HIGH VALUE, LOW EFFORT)

> Assign to: Agent 4
> Dependency: None

### Overview

On each running session card, show a 1-2 sentence AI-generated summary of what Claude is currently working on. Pull from the session's terminal output ring buffer, call Claude API to summarize, cache for 60s.

### D1 — API endpoint

**File:** `apps/web/src/app/api/sessions/[id]/summary/route.ts` (NEW)

```typescript
// GET /api/sessions/:id/summary
// 1. Auth check (session must belong to user or org member)
// 2. Pull last 50 lines from Redis ring buffer (session:logs:{sessionId})
// 3. Call Claude API: "Summarize what this Claude Code session is currently working on in 1-2 sentences. Be specific about the task, not the tool. Output: plain text only."
// 4. Cache result in Redis for 60s (summary:{sessionId})
// 5. Return { summary: string, cachedAt: ISO8601 }
```

Use `claude-haiku-4-5-20251001` — fast and cheap for this use case.

- [ ] Create summary/route.ts
- [ ] Pull from Redis ring buffer
- [ ] Call Claude API (haiku model)
- [ ] Cache 60s in Redis
- [ ] Auth checks
- [ ] TypeScript check passes

### D2 — Session card UI

**File:** `apps/web/src/components/sessions/SessionCard.tsx` or `SessionList.tsx`

- Add small italic summary line below session name on running sessions
- Auto-refresh every 60s (matches cache TTL)
- Show "Analyzing..." on first load, "—" if no output yet
- Gray muted text, max 2 lines, truncate with ellipsis

- [ ] Add summary fetch to session card (SWR with 60s refresh)
- [ ] Render summary text below session info
- [ ] Loading/empty states
- [ ] TypeScript check passes

---

## TRACK E — Mobile Terminal Polish

> Assign to: Agent 5
> Dependency: None

### Overview

xterm.js works on mobile but the experience is rough. Three fixes:

1. Pinch-to-zoom adjusts terminal font size
2. Virtual keyboard doesn't cover the terminal
3. Viewport meta tag prevents iOS double-tap zoom

### E1 — Terminal component mobile fixes

**File:** `apps/web/src/components/sessions/Terminal.tsx`

```typescript
// Add to xterm.js initialization:
// 1. Touch event handler for pinch-to-zoom → adjust terminal.options.fontSize
// 2. window.visualViewport resize listener → adjust terminal height to avoid keyboard
// 3. Add data-testid="terminal-container" attribute (needed for E2E test in Track A)
```

Pinch zoom:

```typescript
let lastDist = 0
termEl.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2)
    lastDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    )
})
termEl.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return
  const dist = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  )
  const delta = dist - lastDist
  lastDist = dist
  const newSize = Math.min(24, Math.max(8, terminal.options.fontSize + delta * 0.05))
  terminal.options.fontSize = newSize
  fitAddon.fit()
})
```

Keyboard avoidance:

```typescript
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const termContainer = termRef.current
    if (!termContainer) return
    termContainer.style.height = `${window.visualViewport.height - termContainer.getBoundingClientRect().top}px`
    fitAddon.fit()
  })
}
```

- [ ] Add pinch-to-zoom handler
- [ ] Add visualViewport resize handler for keyboard avoidance
- [ ] Add data-testid="terminal-container" to terminal wrapper div
- [ ] Test on mobile viewport (375px)
- [ ] TypeScript check passes

### E2 — Viewport meta tag

**File:** `apps/web/src/app/layout.tsx` or `apps/web/src/app/(dashboard)/sessions/[id]/page.tsx`

Ensure viewport meta includes `user-scalable=no` only on the terminal page (to prevent iOS double-tap zoom interfering with xterm):

```typescript
// On session detail page only:
export const metadata = {
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
}
```

- [ ] Add viewport meta to session detail page
- [ ] TypeScript check passes

---

## TRACK F — Session Templates

> Assign to: Agent 6
> Dependency: None — all new tables/routes

### Overview

Save a session configuration (machine + command + workdir + name) as a reusable template. "Start a Claude Code session in my API repo" with one click from the dashboard.

### F1 — DB migration

**File:** `apps/web/src/db/migrations/0010_session_templates.sql`

```sql
CREATE TABLE IF NOT EXISTS session_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  machine_id uuid REFERENCES machines(id) ON DELETE SET NULL,
  command text NOT NULL DEFAULT 'claude',
  workdir text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX session_templates_user_id_idx ON session_templates(user_id);
```

**Schema:** Add `sessionTemplates` table to `schema/index.ts` with Drizzle definition.

- [ ] Write migration SQL
- [ ] Add to schema/index.ts
- [ ] TypeScript check passes

### F2 — API routes

**File:** `apps/web/src/app/api/session-templates/route.ts` (NEW)

- GET: list user's templates
- POST: create template

**File:** `apps/web/src/app/api/session-templates/[id]/route.ts` (NEW)

- DELETE: remove template
- PATCH: rename/update

- [ ] Create route.ts (GET list, POST create)
- [ ] Create [id]/route.ts (DELETE, PATCH)
- [ ] Auth checks (user owns template)
- [ ] TypeScript check passes

### F3 — UI: Templates in Start Session dialog

**File:** `apps/web/src/components/sessions/StartSessionDialog.tsx`

- Add "Templates" section at top of dialog showing saved templates as clickable chips
- Clicking a template pre-fills machine, command, workdir fields
- "Save as template" checkbox at bottom — saves current form values as new template

- [ ] Add templates section to StartSessionDialog
- [ ] Pre-fill on template click
- [ ] Save as template checkbox
- [ ] TypeScript check passes

---

## TRACK G — Agent Auto-Update

> Assign to: Agent 7
> Dependency: Track A must deploy first (need the deploy working)

### Overview

Agent checks for updates on startup. If a newer version exists, downloads and replaces itself, then restarts. Removes the USB drive dependency permanently.

### G1 — Version endpoint

**File:** `apps/web/src/app/api/agent/version/route.ts` (NEW)

```typescript
// GET /api/agent/version
// Returns: { version: "0.1.5", downloadUrl: "https://sessionforge.dev/api/agent/download/windows/amd64" }
// No auth required — public endpoint
```

Store current version as env var `AGENT_CURRENT_VERSION`.

- [ ] Create version/route.ts
- [ ] Add AGENT_CURRENT_VERSION env var

### G2 — Download endpoint

**File:** `apps/web/src/app/api/agent/download/[os]/[arch]/route.ts` (NEW)

For now: redirect to GitHub releases. Later: serve from GCS.

```typescript
// GET /api/agent/download/windows/amd64
// Redirects to: https://github.com/PerryB-GIT/sessionforge/releases/latest/download/sessionforge-windows-amd64.exe
```

- [ ] Create download redirect route
- [ ] Test redirect works

### G3 — Auto-update in agent

**File:** `agent/internal/cli/root.go` or new `agent/internal/updater/updater.go`

On agent startup (after connecting):

1. GET `{serverURL}/api/agent/version`
2. Compare to current version (embed at build time with `-ldflags "-X main.version=0.1.5"`)
3. If newer: download to temp file, verify it runs (`sessionforge.exe --version`), replace self, restart
4. If same: no-op

Use atomic replace: download to `.new` file, stop task, rename, restart scheduled task.

```go
// Embed version at build time:
var version = "dev" // overridden by -ldflags

func checkForUpdate(serverURL string) {
    // ... fetch version, compare, download, replace, restart
}
```

- [ ] Create updater package
- [ ] Embed version via ldflags in build
- [ ] Check on startup (non-blocking goroutine)
- [ ] Atomic replace + scheduled task restart
- [ ] Build passes

---

## TRACK H — Email Notifications for Session Events

> Assign to: Agent 8
> Dependency: None

### Overview

Extend the notification system (already has `session_crashed`, `machine_offline`) with:

- `session_idle` — no output for 10 minutes (Claude may be stuck)
- `session_completed` — session exited cleanly

Send email via Resend (already integrated) when notifications are created.

### H1 — Add notification types to schema

**File:** `apps/web/src/db/schema/index.ts`

Add to `notificationType` enum:

```typescript
;('session_idle', 'session_completed', 'session_adopted')
```

Migration: `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_idle';` etc.

- [ ] Add new enum values to schema
- [ ] Write migration for enum additions
- [ ] TypeScript check passes

### H2 — Session idle detection

**File:** `apps/web/server.js`

In the agent WebSocket handler, track last output time per session in Redis (`session:last_output:{sessionId}`). A background job (setInterval, every 60s) checks all running sessions — if last output > 10 minutes ago and no notification sent yet, create a notification.

```javascript
// Track last output time:
await redis.set(`session:last_output:${sessionId}`, Date.now(), { ex: 86400 })

// Idle check every 60s:
setInterval(async () => {
  // Get all running session IDs from DB
  // For each: check session:last_output:{id}
  // If > 10min and not notified: create notification, set session:idle_notified:{id}
}, 60_000)
```

- [ ] Track last_output timestamp in Redis on session_output
- [ ] Add idle check interval in server.js
- [ ] Create notification when idle threshold exceeded
- [ ] TypeScript check passes

### H3 — Email delivery

**File:** `apps/web/src/lib/notifications.ts` (new or existing)

After creating a notification row, send email via Resend if user has email notifications enabled.

Email templates:

- **session_idle:** "Your Claude Code session on [machine] hasn't produced output in 10 minutes. It may need your attention."
- **session_completed:** "Your Claude Code session on [machine] finished. [duration] elapsed."
- **session_adopted:** "[name] joined your session on [machine]."

- [ ] Create/extend notifications helper
- [ ] Send email on notification create
- [ ] Respect user notification preferences (already in schema)
- [ ] TypeScript check passes

---

## TRACK I — Slack / Discord Notifications (Webhook Destinations)

> Assign to: Agent 9
> Dependency: None — extends existing webhook system

### Overview

The webhook system already delivers to arbitrary HTTP URLs. Add first-class Slack and Discord support: user pastes their Slack/Discord webhook URL into settings, we handle the formatting.

### I1 — Detect and format Slack/Discord payloads

**File:** `apps/web/src/lib/webhooks.ts` or `apps/web/server.js` webhook delivery code

When delivering a webhook:

- If URL matches `hooks.slack.com` → format as Slack Block Kit message
- If URL matches `discord.com/api/webhooks` → format as Discord embed
- Otherwise → existing JSON format

Slack format for `session_crashed`:

```json
{
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "🔴 Session Crashed" } },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Machine:* [name]\n*Command:* [command]\n*Duration:* [duration]"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "View Session" },
          "url": "https://sessionforge.dev/sessions/[id]"
        }
      ]
    }
  ]
}
```

- [ ] Add Slack URL detection and Block Kit formatting
- [ ] Add Discord URL detection and embed formatting
- [ ] Test with real Slack/Discord webhook URL
- [ ] TypeScript check passes

### I2 — UI: Label webhook type

**File:** `apps/web/src/app/(dashboard)/webhooks/page.tsx`

When displaying webhooks, show a Slack/Discord/Custom badge based on URL.
When creating a webhook, add helper text: "Paste a Slack or Discord webhook URL for automatic formatting."

- [ ] Add type detection + badge to webhook list
- [ ] Add helper text to webhook creation form
- [ ] TypeScript check passes

---

## TRACK J — Usage Dashboard

> Assign to: Agent 10
> Dependency: None

### Overview

Show per-machine and per-user AI session usage: hours of agent time, sessions started, crash rate, active time vs idle time. Makes people feel productive AND creates natural upgrade prompts.

### J1 — Usage aggregation query

**File:** `apps/web/src/app/api/usage/route.ts` (modify existing)

Add to the usage response:

```typescript
{
  // existing fields...
  agentHoursThisMonth: number,       // sum of (stoppedAt - startedAt) for sessions this month
  sessionsThisMonth: number,         // count of sessions started this month
  crashRateThisMonth: number,        // % sessions with status='crashed'
  avgSessionDurationMinutes: number, // mean session duration
  byMachine: [{
    machineId, machineName,
    sessions: number,
    hours: number,
    lastActive: ISO8601
  }]
}
```

All computable from the `sessions` table with Drizzle aggregation queries.

- [ ] Extend usage API with new fields
- [ ] Drizzle aggregation queries (sum, count, avg)
- [ ] TypeScript check passes

### J2 — Usage page UI

**File:** `apps/web/src/app/(dashboard)/settings/page.tsx` or new `/usage/page.tsx`

Display:

- "This month: X hours of AI agent time across Y sessions"
- Bar chart per machine (use Recharts — already in the stack)
- Crash rate indicator (red if > 10%)
- "Upgrade to Pro for unlimited history" if on free tier

- [ ] Add usage section to dashboard or create /usage page
- [ ] Recharts bar chart per machine
- [ ] Upgrade prompt for free tier
- [ ] TypeScript check passes

---

## TRACK K — Process Discovery → Auto-Adopt

> Assign to: Agent 11
> Dependency: Track B (adopt API must exist)

### Overview

The sessions page already shows a banner with "discovered processes" (unmanaged Claude Code processes detected by the agent). Wire the "Adopt" button to actually work: create a managed session record from the discovered process.

### K1 — Discovered processes table

**File:** `apps/web/src/db/migrations/0011_discovered_processes.sql`

```sql
CREATE TABLE IF NOT EXISTS discovered_processes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  pid integer NOT NULL,
  process_name text NOT NULL,
  command_line text,
  workdir text,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  adopted_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL
);
CREATE INDEX discovered_processes_machine_id_idx ON discovered_processes(machine_id);
```

- [ ] Write migration
- [ ] Add to schema/index.ts
- [ ] TypeScript check passes

### K2 — Adopt discovered process endpoint

**File:** `apps/web/src/app/api/machines/[id]/adopt-process/route.ts` (NEW)

```
POST /api/machines/:machineId/adopt-process
Body: { pid: number, processName: string, workdir?: string }

1. Create a sessions row with status='running', pid=pid, processName=processName
2. Send start_adopt message to agent via Redis (agent binds the existing PTY to the new session ID)
3. Mark adopted_session_id on discovered_processes row
4. Return { sessionId } → client navigates to /sessions/:id
```

Agent side: handle `adopt_process` message type — find the running process by PID, attach PTY reader/writer to it, register as a managed session.

- [ ] Create adopt-process route
- [ ] Send adopt_process message to agent via Redis
- [ ] Agent handles adopt_process message (attach to existing process)
- [ ] TypeScript check passes

### K3 — Wire the UI button

**File:** `apps/web/src/app/(dashboard)/sessions/page.tsx`

Change "Adopt — coming soon" buttons to call POST `/api/machines/:id/adopt-process`, then navigate to the new session.

- [ ] Replace coming-soon with real API call
- [ ] Loading state on adopt button
- [ ] Navigate to new session on success
- [ ] TypeScript check passes

---

## TRACK L — One-Click Read-Only Share Link

> Assign to: Agent 12
> Dependency: Track B (adopt infrastructure)

### Overview

Generate a public read-only URL for a session. Anyone with the link can watch the terminal (no login required). Like a Figma share link but for your Claude Code terminal.

### L1 — Share tokens table

**File:** `apps/web/src/db/migrations/0012_session_share_tokens.sql`

```sql
CREATE TABLE IF NOT EXISTS session_share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX session_share_tokens_token_idx ON session_share_tokens(token);
```

- [ ] Write migration
- [ ] Add to schema/index.ts

### L2 — Share API + public terminal page

**File:** `apps/web/src/app/api/sessions/[id]/share/route.ts`

- POST: create share token (owner only)
- DELETE: revoke token

**File:** `apps/web/src/app/share/[token]/page.tsx`

- Public page (no auth required)
- Read-only terminal (no stdin)
- Shows session info + read-only xterm.js
- Banner: "Viewing [owner]'s session on [machine] — read only"

**File:** `apps/web/src/app/api/share/[token]/ws/route.ts` or extend server.js

- WebSocket that accepts token auth (not session cookie)
- Read-only: forwards session_output, ignores session_input

- [ ] Share API (create/revoke token)
- [ ] Public terminal page
- [ ] Token-auth WebSocket (read-only)
- [ ] TypeScript check passes

---

## DEPLOYMENT CHECKLIST

After all tracks complete:

- [ ] All TypeScript checks pass: `cd apps/web && npx tsc --noEmit`
- [ ] Agent builds: `cd agent && go build ./...`
- [ ] Run DB migrations (deploy triggers migration on Cloud Run startup)
- [ ] `gcloud auth login` (Perry interactive)
- [ ] `gcloud run deploy sessionforge --source . --region us-central1 --allow-unauthenticated`
- [ ] Switch Stripe to live mode (see LAUNCH-PLAN.md)
- [ ] Verify: `curl -s https://sessionforge.dev/api/health`
- [ ] Smoke test: sign up, add machine, start session, adopt session
- [ ] Build new agent binary with version ldflags
- [ ] Update USB drive with new binary

---

## LAUNCH SEQUENCE

See `docs/LAUNCH-PLAN.md` for full content. Execute after deployment checklist is green.

Updated tagline recommendations (for rebrand targeting Claude Code users):

**Primary:** "Mission control for your AI agents"
**Alternative:** "Remote access for Claude Code — from any device"
**Short:** "Your AI agents, always in reach"

Product Hunt tagline update: "Adopt, monitor, and hand off Claude Code sessions from anywhere"

---

## PRIORITY ORDER FOR PARALLEL EXECUTION

| Track | What                | Effort | Impact             | Start When      |
| ----- | ------------------- | ------ | ------------------ | --------------- |
| A     | P0 blockers         | 2h     | Unblocks launch    | NOW             |
| B     | Adopt Session       | 1 day  | Core feature       | NOW             |
| C     | /sf-pause skill     | 4h     | Demo story         | After B deploys |
| D     | AI summary          | 4h     | High delight       | NOW             |
| E     | Mobile terminal     | 4h     | Demo quality       | NOW             |
| F     | Session templates   | 1 day  | Power users        | NOW             |
| G     | Auto-update         | 1 day  | Ops                | After A deploys |
| H     | Email notifications | 4h     | Retention          | NOW             |
| I     | Slack/Discord       | 4h     | Team plan          | NOW             |
| J     | Usage dashboard     | 1 day  | Upgrade conversion | NOW             |
| K     | Process auto-adopt  | 1 day  | Killer feature     | After B deploys |
| L     | Share links         | 1 day  | Virality           | After B deploys |

**Tracks that can start RIGHT NOW (no dependencies):** A, B, D, E, F, H, I, J
**Tracks waiting on B deploy:** C, K, L
**Tracks waiting on A deploy:** G
