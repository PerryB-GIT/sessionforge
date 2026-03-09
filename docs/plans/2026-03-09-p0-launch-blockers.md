# P0 Launch Blockers — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clear all P0 launch blockers: remove noisy debug logs, fix garbled `sessionforge run` output, and add a Playwright E2E terminal test.

**Architecture:** Three independent changes across Go agent and Next.js server. No cross-dependencies — can be executed in parallel. Each change is surgical with minimal blast radius.

**Tech Stack:** Go 1.22 (agent), Node.js/Next.js 14 (server.js), TypeScript (Playwright E2E)

---

## OVERRIDING ENGINEERING PRINCIPLES

- Simplicity First: touch only the lines that need changing
- Minimal Impact: no refactors beyond what's asked
- Verify before done: build/type-check after each task

---

## Task 1: Remove Debug Logs from server.js

**Files:**

- Modify: `apps/web/server.js` (lines 668-671 and 689-695)

**What to change:**

Remove the "RAW ARRIVAL" block (lines 668-671):

```javascript
// REMOVE these 4 lines:
// Raw arrival log — shows every message type reaching Node.js WS layer.
if (msg.type !== 'heartbeat' && msg.type !== 'pong') {
  console.log('[ws/agent] RAW ARRIVAL type:', msg.type, 'bytes:', raw.length)
}
```

Remove the "session_output publishing" block (lines 689-695):

```javascript
// REMOVE these 6 lines:
const ownerUserId = sessionUserIdCache.get(sessionId)
console.log('[ws/agent] session_output publishing sid:', sessionId, 'ownerUserId:', ownerUserId)
```

NOTE: The `const ownerUserId = sessionUserIdCache.get(sessionId)` line is used downstream — check if it's referenced after the removed block. If `ownerUserId` is used later in the same code path, keep the variable declaration and only remove the `console.log` call.

**Verification:**

- `grep -n "RAW ARRIVAL\|session_output publishing" apps/web/server.js` → should return nothing
- `node --check apps/web/server.js` → no syntax errors

---

## Task 2: Downgrade writeLoop logs in client.go from Info to Debug

**Files:**

- Modify: `agent/internal/connection/client.go` (lines 253, 259)

**What to change:**

Line 253 — change Info to Debug:

```go
// FROM:
c.logger.Info("writeLoop: sending", "bytes", len(data))
// TO:
c.logger.Debug("writeLoop: sending", "bytes", len(data))
```

Line 259 — change Info to Debug:

```go
// FROM:
c.logger.Info("writeLoop: sent ok", "bytes", len(data))
// TO:
c.logger.Debug("writeLoop: sent ok", "bytes", len(data))
```

**Verification:**

- `cd C:\Users\Jakeb\sessionforge\agent && C:\Users\Jakeb\go\bin\go.exe build ./...` → no errors
- `grep -n 'writeLoop: send' agent/internal/connection/client.go` → both lines now say `.Debug(`

---

## Task 3: Fix garbled output in `sessionforge run` (logs racing on stdout)

**Problem:** When `sessionforge run claude` is active, PTY output goes to stdout via `localFn`, but the logger (built with `buildLogger`) also writes to stderr. If `cfg.LogFile` is set, `buildLogger` creates a `MultiWriter(file, stderr)` — log output goes to stderr. But the `os.Stderr` writes from `run.go` (session ID, "Press Ctrl+]") can interleave with PTY output on stdout if the terminal mixes them.

The real issue is that agent INFO logs (heartbeat, register, session_output chunks, writeLoop) are INFO level and go to stderr, which the terminal renders interleaved with PTY stdout. During `sessionforge run`, the raw PTY output is on stdout and logs are on stderr — in a typical terminal these share the same display.

**Fix:** In `run.go`, after the `buildLogger` call inside `runRun`, override the logger to write to the log file only (not stderr) when a log file is configured. When no log file is configured, suppress logs entirely during PTY passthrough (set level to Error so only crashes print).

**Files:**

- Modify: `agent/internal/cli/run.go`

**What to change:**

In `runRun`, replace:

```go
logger := buildLogger(cfg.LogLevel, cfg.LogFile)
client, mgr := buildAgentComponents(ctx, cfg)
```

With:

```go
// During 'run', PTY output goes to stdout. Route all logs to file-only
// (if configured) or suppress to error-level-only to prevent log lines
// from garbling the terminal display.
logger := buildRunLogger(cfg.LogLevel, cfg.LogFile)
client, mgr := buildAgentComponents(ctx, cfg)
```

Add new function `buildRunLogger` in `run.go`:

```go
// buildRunLogger builds a logger for 'sessionforge run' mode.
// PTY output owns stdout; logs must not interleave with it.
// If a log file is configured, write logs there only (not stderr).
// If no log file, suppress to Error level so only crashes appear.
func buildRunLogger(level, logFile string) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	default:
		l = slog.LevelError // suppress info/debug during PTY passthrough
	}

	var w io.Writer = io.Discard
	if logFile != "" {
		f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if err == nil {
			w = f
			// With a log file, restore requested log level
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

Also add `"io"` to the imports in `run.go` if not already present.

**Verification:**

- `cd C:\Users\Jakeb\sessionforge\agent && C:\Users\Jakeb\go\bin\go.exe build ./...` → no errors
- Run `sessionforge run bash` locally → no log lines interleaved with shell output

---

## Task 4: Add Playwright E2E test for terminal session output

**Files:**

- Modify: `apps/web/e2e/dashboard.spec.ts`

**What to add:**

In the "Session detail page" test suite (around line 202), add a new test that:

1. Navigates to the sessions list
2. Clicks on an active session (if one exists) or skips if none
3. Verifies the terminal container is rendered
4. Checks that xterm.js canvas is present in the DOM

```typescript
test('terminal container renders for active session', async ({ page }) => {
  await page.goto('/sessions')

  // Find first active session row
  const activeSession = page.locator('[data-status="running"], [data-status="active"]').first()
  const count = await activeSession.count()

  if (count === 0) {
    test.skip() // No active sessions in this environment
    return
  }

  await activeSession.click()

  // Terminal container should be present
  await expect(
    page.locator('[data-testid="terminal-container"], .xterm, .xterm-screen')
  ).toBeVisible({ timeout: 10000 })
})
```

Also unskip the existing skipped test for terminal container (find `test.skip` near "terminal container" in the session detail section) — change `test.skip(` to `test(` if the selector matches the current DOM.

**Verification:**

- `cd apps/web && npx tsc --noEmit` → no type errors
- `BASE_URL=https://sessionforge.dev npx playwright test e2e/dashboard.spec.ts --project=chromium-auth 2>&1 | head -40` → test runs (may skip if no active session, that's OK)

---

## Execution Order

Tasks 1, 2, 3 can be done in parallel (different files, no dependencies).
Task 4 depends on nothing else — also parallel.

Build the agent binary after Tasks 2 and 3 complete:

```bash
cd C:\Users\Jakeb\sessionforge\agent
C:\Users\Jakeb\go\bin\go.exe build -o C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe ./cmd/agent
```

Deploy server.js changes (Tasks 1) via normal git push → staging auto-deploy.
