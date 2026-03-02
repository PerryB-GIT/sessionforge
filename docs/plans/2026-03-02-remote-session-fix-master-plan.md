# SessionForge Remote Session Fix — Master Plan

# For Claude Code parallel agent execution

> **INSTRUCTIONS FOR ALL AGENTS**: This plan is divided into 5 independent workstreams.
> Each agent owns one workstream. Read ONLY your workstream section.
> All agents work on the `master` branch directly — communicate conflicts via this file.
> Test command after each task: `cd agent && go build ./...` (must pass before committing)

---

## CONTEXT: WHY REMOTE SESSIONS DON'T WORK

Three audits identified the following root causes (ranked by blast radius):

### Root Cause #1 — Agent can't find `claude` (Windows service runs as LocalSystem)

The service binary runs as LocalSystem which only has system PATH.
`claude.cmd` lives in `C:\Users\<user>\AppData\Roaming\npm\` — NOT in system PATH.
Result: `exec.LookPath("claude")` fails → sessions never start.
**Status: Partially fixed (lookPathWithNpmFallback added) but not fully tested.**

### Root Cause #2 — `CreateProcess` can't run `.cmd` files directly

Windows `CreateProcess` requires an `.exe`. `claude` resolves to `claude.cmd`.
The `cmd.exe /C claude.cmd` wrapper was added but not verified working via ConPTY.
**Status: Code added, not tested end-to-end.**

### Root Cause #3 — Debug code / hardcoded paths blocking production

`manager.go` and `pty_windows.go` have hardcoded `C:\Users\Jakeb\` paths.
The service running for ANY other user will fail silently.
**Status: Must be fixed before any release.**

### Root Cause #4 — CLAUDECODE env var leak

Even though the service's `os.Environ()` doesn't have CLAUDECODE,
the `buildEnvBlock` has a logic flaw — the debug logging code is mixed
with the deletion code in a confusing way. The Unix path doesn't strip it at all.
**Status: Needs clean rewrite.**

### Root Cause #5 — Terminal resize not sent on connect

Terminal size defaults to 80x24. No resize message sent until ResizeObserver fires.
Sessions start with wrong PTY dimensions → line wrapping broken.
**Status: Bug confirmed, not fixed.**

### Root Cause #6 — Session output lost before subscription

Agent starts session → sends output immediately.
Browser subscribes to session ~100ms later.
Ring buffer exists but is populated AFTER output starts flowing.
**Status: Design gap, needs ring buffer pre-allocation.**

### Root Cause #7 — Service installs as LocalSystem instead of current user

The real fix for #1/#2 is to run the service as the INSTALLING USER's account,
not LocalSystem. That gives the service the user's PATH including npm.
**Status: Not implemented.**

---

## WORKSTREAM ASSIGNMENTS

---

## WORKSTREAM A — Agent Core: Command Resolution + Clean Env Block

**Owner: Agent A | Files: `agent/internal/session/pty_windows.go`, `pty_unix.go`, `manager.go`**

### Goal

Make `resolveCommand` bulletproof and remove ALL debug/hardcoded code.

### Task A1 — Clean up all debug logging

Remove hardcoded debug paths. Replace with proper slog calls via the manager's logger.
The `dbgLog()` function in `pty_windows.go` MUST be deleted.
The debug block in `manager.go` (lines 124-134) MUST be deleted.

**Files to edit:**

- `agent/internal/session/manager.go` — remove debug file-write block
- `agent/internal/session/pty_windows.go` — remove `dbgLog()` and all calls to it

**Test:** `go build ./...` must pass with no references to `C:\Users\Jakeb` in any `.go` file.

### Task A2 — Fix buildEnvBlock — clean rewrite

Current implementation is confusing and mixes debug code with logic.
Rewrite it cleanly:

```go
func buildEnvBlock(overlay map[string]string) *uint16 {
    // Strip vars that must never reach the child process.
    blocked := map[string]bool{
        "CLAUDECODE": true,  // prevents "nested session" error
    }

    merged := make(map[string]string)
    for _, kv := range os.Environ() {
        if idx := strings.IndexByte(kv, '='); idx > 0 {
            key := kv[:idx]
            if !blocked[key] {
                merged[key] = kv[idx+1:]
            }
        }
    }
    for k, v := range overlay {
        if !blocked[k] {
            merged[k] = v
        }
    }
    merged["TERM"] = "xterm-256color"

    var pairs []uint16
    for k, v := range merged {
        entry := k + "=" + v
        encoded, err := syscall.UTF16FromString(entry)
        if err != nil {
            continue
        }
        pairs = append(pairs, encoded...)
    }
    if len(pairs) == 0 {
        return nil
    }
    pairs = append(pairs, 0) // double-null terminator
    return &pairs[0]
}
```

Note: The `&pairs[0]` is safe here because `pairs` escapes to heap via append.
The `var pairs []uint16` followed by append causes heap allocation.

**Files to edit:** `agent/internal/session/pty_windows.go`

### Task A3 — Fix Unix CLAUDECODE removal

`pty_unix.go` does not strip CLAUDECODE. Fix it:

```go
// Build environment: inherit + overlay, stripping vars that must not reach child.
blocked := map[string]bool{"CLAUDECODE": true}
for _, kv := range os.Environ() {
    if idx := strings.IndexByte(kv, '='); idx > 0 {
        if !blocked[kv[:idx]] {
            cmd.Env = append(cmd.Env, kv)
        }
    }
}
for k, v := range env {
    if !blocked[k] {
        cmd.Env = append(cmd.Env, k+"="+v)
    }
}
cmd.Env = append(cmd.Env, "TERM=xterm-256color")
```

**Files to edit:** `agent/internal/session/pty_unix.go`

### Task A4 — Cache the npm fallback path

`lookPathWithNpmFallback` scans `C:\Users\` on every session spawn.
Cache the result at package level after first successful lookup:

```go
var (
    cachedClaudePath   string
    cachedClaudePathMu sync.Once
)
```

Use `sync.Once` to run the scan once and store the result.

**Files to edit:** `agent/internal/session/pty_windows.go`

### Task A5 — Add spawnWithPipes TERM setting

`spawnWithPipes` (the ConPTY fallback) doesn't set `TERM=xterm-256color`.
Add it to match `buildEnvBlock` behavior.

### Completion check for Workstream A

```bash
cd agent
go build ./...
grep -r "C:\\\\Users\\\\Jakeb" --include="*.go" .  # must return nothing
grep -r "dbgLog\|sf-env.log" --include="*.go" .     # must return nothing
```

---

## WORKSTREAM B — Service: Run as Current User (Not LocalSystem)

**Owner: Agent B | Files: `agent/internal/cli/service_windows.go`**

### Goal

The REAL fix for PATH issues: run the service as the INSTALLING USER'S account,
not as LocalSystem. This gives the service the user's PATH including npm/claude.

### Task B1 — Change service to run as current user

In `runServiceInstall`, change `mgr.Config{}` to add `ServiceStartName` (the user account):

```go
// Get the current user's UPN (e.g. DESKTOP-XXX\Jakeb)
currentUser, err := user.Current()
if err != nil {
    return fmt.Errorf("get current user: %w", err)
}

// Prompt for password (needed to register service under user account)
// OR use a different approach: SetServiceObjectSecurity
```

**IMPORTANT CAVEAT:** Running a service as a user account requires providing
the user's password to the SCM. This is awkward. Better alternatives:

**Option 1 (Recommended):** Keep LocalSystem but set the user's PATH explicitly
in the service environment using the registry. Add the npm path to the service's
environment block via SCM registry key:

```
HKLM\SYSTEM\CurrentControlSet\Services\SessionForgeAgent\Environment
PATH=<system_path>;<user_npm_path>
```

**Option 2:** Run as LocalSystem but store the resolved `claude` path in config.toml
during install (when the installer runs as the user with correct PATH).

**Implement Option 2** — it's the safest:

In `runServiceInstall`, before creating the service:

```go
// Resolve claude path now (while running as the user with correct PATH)
claudePath, err := exec.LookPath("claude")
if err != nil {
    // Try npm fallback
    claudePath, err = lookPathInUserProfile(os.Getenv("USERPROFILE"), "claude")
    if err != nil {
        fmt.Println("WARNING: 'claude' not found in PATH. Install claude CLI before starting sessions.")
    }
}
if claudePath != "" {
    cfg.ClaudePath = claudePath
    // Save to config.toml
    if err := config.SaveFrom(configDir, cfg); err != nil {
        return fmt.Errorf("save config: %w", err)
    }
    fmt.Printf("Stored claude path: %s\n", claudePath)
}
```

### Task B2 — Add ClaudePath to config.Config struct

In `agent/internal/config/config.go`:

```go
type Config struct {
    // ... existing fields ...

    // ClaudePath is the absolute path to the claude CLI binary, resolved at install time.
    // This is used when the service runs as LocalSystem and the user's npm PATH is unavailable.
    ClaudePath string `toml:"claude_path,omitempty"`
}
```

### Task B3 — Use ClaudePath in resolveCommand

In `pty_windows.go`, `resolveCommand` should check config first:

```go
// In spawnPTY, pass config through OR use a package-level config reference
// The cleanest approach: add a package-level var set by the Manager
var configuredClaudePath string // set by Manager.SetClaudePath(path)
```

In `Manager`:

```go
func (m *Manager) SetClaudePath(path string) {
    // package-level in session package
    session.SetClaudePath(path)
}
```

### Task B4 — Add pre-flight check to `service install`

Before installing the service, check:

1. Is `claude` CLI installed and runnable?
2. Is the config dir writable?
3. Does the agent binary exist?

Print clear errors if any check fails.

### Completion check for Workstream B

```bash
cd agent && go build ./...
# Config should have ClaudePath field
grep "ClaudePath" internal/config/config.go  # must exist
grep "claude_path" internal/config/config.go # must exist
```

---

## WORKSTREAM C — Web Server: Terminal + WebSocket Pipeline Fixes

**Owner: Agent C | Files: `apps/web/server.js`, `apps/web/src/components/sessions/Terminal.tsx`**

### Goal

Fix the 3 most critical web-side bugs that break the remote session UX.

### Task C1 — Fix Terminal resize on connect

In `Terminal.tsx`, send resize immediately after WebSocket opens:

```typescript
ws.onopen = () => {
  // Subscribe to session stream
  ws.send(JSON.stringify({ type: 'subscribe_session', sessionId }))

  // Send current terminal size IMMEDIATELY — don't wait for ResizeObserver
  if (terminal && !readOnly) {
    ws.send(
      JSON.stringify({
        type: 'resize',
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      })
    )
  }
}
```

Also ensure the `fitAddon.fit()` is called before the WS connects so dimensions are correct.

### Task C2 — Fix output decoding with proper error handling

In `Terminal.tsx` ws.onmessage handler:

```typescript
ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data as string)
    if (msg.type === 'session_output' && msg.sessionId === sessionId) {
      if (typeof msg.data === 'string' && msg.data.length > 0) {
        try {
          const decoded = atob(msg.data)
          terminalRef.current?.write(decoded)
        } catch (decodeErr) {
          console.warn('[Terminal] base64 decode failed, writing raw:', decodeErr)
          terminalRef.current?.write(msg.data)
        }
      }
    }
  } catch (parseErr) {
    console.warn('[Terminal] message parse failed:', parseErr)
    // Do NOT write raw event data — it would show JSON noise in terminal
  }
}
```

Remove the `catch { terminalRef.current?.write(event.data as string) }` fallback —
it writes raw JSON to the terminal which is confusing.

### Task C3 — Pre-allocate ring buffer on session_started

In `server.js`, in the `session_started` handler, ensure the ring buffer key exists
before any output can arrive:

```javascript
case 'session_started': {
  const { session: s } = msg

  // Pre-allocate ring buffer so dashboard subscriptions don't miss early output
  const logKey = StreamKeys.sessionLogs(s.id)
  await redis.expire(logKey, SESSION_LOG_TTL_SECONDS)  // Set TTL even if empty

  await query(
    `UPDATE sessions SET pid = $1, process_name = $2, workdir = $3,
     status = 'running', started_at = $4 WHERE id = $5`,
    [s.pid, s.processName, s.workdir, new Date(s.startedAt), s.id]
  )
  // ... rest of handler
}
```

### Task C4 — Add input size validation in server.js

In the `session_input` handler in `handleDashboardWs`:

```javascript
case 'session_input': {
  if (!msg.sessionId || !msg.data) break
  if (typeof msg.data !== 'string' || msg.data.length > 8192) {
    console.warn('[ws/dashboard] session_input too large or invalid, dropping')
    break
  }
  // ... rest of handler
}
```

### Task C5 — Add missing dashboard WS route placeholder

Create `apps/web/src/app/api/ws/dashboard/route.ts`:

```typescript
// WebSocket upgrade for /api/ws/dashboard is handled by the custom server (server.js).
// This file exists so Next.js does not 404 HTTP requests to this path.
export async function GET() {
  return new Response('WebSocket endpoint — use ws:// protocol', { status: 426 })
}
```

### Completion check for Workstream C

```bash
cd apps/web
npx tsc --noEmit  # must pass
grep "write(event.data" src/components/sessions/Terminal.tsx  # must return nothing
```

---

## WORKSTREAM D — GitHub Actions + Release Pipeline

**Owner: Agent D | Files: `.github/workflows/`, `agent/cmd/sessionforge/`**

### Goal

Ensure the agent binary gets built and released correctly on every push to master,
and that the download URL in the dashboard actually works.

### Task D1 — Read and audit all existing workflow files

Read every file in `.github/workflows/` and document what each does.

### Task D2 — Ensure agent release workflow exists and is correct

There must be a workflow that:

1. Triggers on `push` to `main`/`master` OR on `workflow_dispatch`
2. Builds `sessionforge.exe` for `GOOS=windows GOARCH=amd64`
3. Uploads as a GitHub Release artifact OR as a workflow artifact
4. The download URL must be deterministic (e.g., `/releases/latest/download/sessionforge.exe`)

If no such workflow exists, create `.github/workflows/release-agent.yml`:

```yaml
name: Release Agent

on:
  push:
    branches: [master, main]
    paths:
      - 'agent/**'
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
          cache-dependency-path: agent/go.sum
      - name: Build Windows agent
        run: |
          cd agent
          go build -ldflags="-s -w -X main.version=${{ github.sha }}" -o sessionforge.exe ./cmd/sessionforge/
        env:
          GOOS: windows
          GOARCH: amd64
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: sessionforge-windows-amd64
          path: agent/sessionforge.exe
          retention-days: 30
      - name: Create Release
        if: github.ref == 'refs/heads/master'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: latest
          files: agent/sessionforge.exe
          generate_release_notes: false
```

### Task D3 — Verify the install command shown in the dashboard is correct

Find where the dashboard shows the agent install command to the user.
Search for: `sessionforge` in `apps/web/src/` files related to setup/onboarding.

The install command should be a single PowerShell one-liner:

```powershell
irm https://sessionforge.dev/install.ps1 | iex
```

OR a direct download:

```powershell
Invoke-WebRequest -Uri "https://github.com/PerryB-GIT/sessionforge/releases/latest/download/sessionforge.exe" -OutFile "sessionforge.exe"
.\sessionforge.exe auth login --key YOUR_API_KEY
.\sessionforge.exe service install
.\sessionforge.exe service start
```

If the install command in the dashboard doesn't match the actual release URL, fix it.

### Task D4 — Add a CI check for Go compilation

Add to existing CI workflow (or create new):

```yaml
- name: Verify agent builds
  run: |
    cd agent
    go vet ./...
    go build ./...
  env:
    GOOS: windows
    GOARCH: amd64
```

### Completion check for Workstream D

```bash
ls .github/workflows/
# Must include a workflow that builds and releases sessionforge.exe
```

---

## WORKSTREAM E — Dashboard UX: Session Start Flow + Status

**Owner: Agent E | Files: `apps/web/src/` — session-related pages and components**

### Goal

Fix the user-facing session start flow so users understand:

1. How to install the agent
2. What's happening when they click "New Session"
3. Why a session might fail (clear error messages)
4. That the terminal works once connected

### Task E1 — Find and audit the machine detail / session start UI

Search for files that contain "New Session" or "start session" in `apps/web/src/`.
Read and audit:

- The page/component where users start a new session
- The API call that creates a session (POST /api/sessions)
- The error handling when session start fails
- The loading/status states

### Task E2 — Add clear error states for session start failures

When POST /api/sessions returns an error, the UI must show:

- `MACHINE_OFFLINE` → "Your machine is offline. Make sure the SessionForge agent is running."
- `PLAN_LIMIT_ERROR` → "You've reached your session limit. Upgrade to start more sessions."
- `NOT_FOUND` → "Machine not found. It may have been removed."
- Network error → "Connection failed. Check your internet and try again."

Currently these errors likely show generic toasts. Make them specific and actionable.

### Task E3 — Add agent health status on machine card

On the machine list/detail view, show:

- Last seen timestamp (already in DB as `last_seen`)
- Whether the agent version is current (compare to latest release tag)
- A "Install agent" button/link for machines that haven't connected yet

### Task E4 — Add install instructions modal/page

When a user has no machines, show clear install instructions:

```
1. Download the agent: [Download sessionforge.exe]
2. Run: sessionforge.exe auth login --key sf_live_xxxxx
3. Run: sessionforge.exe service install
4. Run: sessionforge.exe service start
```

The API key should be pre-filled from the user's account.

### Task E5 — Verify terminal connects to correct session on page load

In `Terminal.tsx`, the `sessionId` prop must be passed correctly from the parent page.
Verify that:

1. The Terminal component receives the correct sessionId
2. It subscribes to the right WebSocket session
3. The readOnly prop is set correctly based on session status

### Completion check for Workstream E

```bash
cd apps/web && npx tsc --noEmit  # must pass
```

---

## COORDINATION RULES

### File ownership (no conflicts)

| Agent | Files they OWN (only they edit)                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------- |
| A     | `agent/internal/session/pty_windows.go`, `pty_unix.go`, `manager.go`                                                |
| B     | `agent/internal/cli/service_windows.go`, `agent/internal/config/config.go`                                          |
| C     | `apps/web/server.js`, `apps/web/src/components/sessions/Terminal.tsx`, `apps/web/src/app/api/ws/dashboard/route.ts` |
| D     | `.github/workflows/*.yml`, `apps/web/src/` install/setup pages only                                                 |
| E     | `apps/web/src/` — session pages, machine pages, components (NOT Terminal.tsx)                                       |

### Shared files (coordinate before editing)

- `apps/web/src/store.ts` — Agent E may edit, announce before doing so
- `packages/shared-types/` — Any agent may need to add types, coordinate

### Git workflow

All agents commit to `master` branch directly.
Commit message format: `fix(agent-A): description` / `fix(agent-C): description` etc.
After each task, run `go build ./...` or `npx tsc --noEmit` before committing.

### Definition of Done

The system works when:

1. `sessionforge service install && sessionforge service start` completes without errors
2. Machine shows as "online" in sessionforge.dev dashboard
3. "New Session" starts a session that shows a terminal
4. Typing in the terminal sends input to the remote claude process
5. Claude's output appears in the terminal in real-time
6. Closing the terminal stops the session cleanly

---

## PRIORITY ORDER

Fix these in this order — each unblocks the next:

1. **[A1, A2, A3]** — Clean agent code, fix env block → sessions can start
2. **[B1, B2, B3]** — Store claude path in config → service finds claude
3. **[C1, C2]** — Fix terminal resize + output decoding → I/O actually works
4. **[C3]** — Pre-allocate ring buffer → no lost output
5. **[D1-D4]** — Release pipeline → users can download working binary
6. **[E1-E5]** — UX polish → users know what's happening
7. **[A4, B4, C4, C5]** — Security + validation hardening

---

_Generated: 2026-03-02 | Based on 3-agent audit covering 22 Go bugs, 17 WebSocket/pipeline bugs, and installer gaps_
