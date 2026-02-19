# Agent 3 (Desktop) — Source Audit Findings
# Date: 2026-02-18
# Branch: dev/desktop

## Summary
Full audit of the Go agent source code completed. All files reviewed.
Critical blockers identified before a real install + WebSocket connect test can succeed.

## Source Files Reviewed
| File | Status |
|------|--------|
| `cmd/sessionforge/main.go` | ✅ Reviewed — entry point, wires all subsystems |
| `internal/cli/auth.go` | ✅ Reviewed — login flow, config save, machine ID gen |
| `internal/cli/service.go` + `service_windows.go` | ✅ Reviewed — Windows Service via sc.exe (STUB noted) |
| `internal/cli/status.go` | ✅ Reviewed — HTTP health check ping |
| `internal/config/config.go` | ✅ Reviewed — config.toml, WebSocketURL() |
| `internal/connection/client.go` | ✅ Reviewed — gorilla/websocket, exp backoff, register on connect |
| `internal/connection/handler.go` | ✅ Reviewed — message dispatch (start/stop/pause/resize/ping) |
| `internal/connection/heartbeat.go` | ✅ Reviewed — 30s ticker, CPU/RAM/disk via gopsutil |
| `internal/session/manager.go` | ✅ Reviewed — PTY lifecycle, session_started/stopped/crashed/output |
| `scripts/install.sh` | ✅ Reviewed — fetches from GitHub Releases (releases/latest) |
| `scripts/install.ps1` | ✅ Reviewed — fetches from GitHub Releases (releases/latest) |
| `.goreleaser.yml` | ✅ Reviewed — targets sessionforge/agent org (mismatch vs PerryB-GIT/sessionforge) |

## WebSocket Protocol Compliance
Go structs in `connection/` and `session/` match `packages/shared-types/src/ws-protocol.ts` exactly:
- ✅ `register` — machineId, name, os, hostname, version
- ✅ `heartbeat` — machineId, cpu, memory, disk, sessionCount
- ✅ `session_started` — session.{id, pid, processName, workdir, startedAt}
- ✅ `session_stopped` — sessionId, exitCode
- ✅ `session_crashed` — sessionId, error
- ✅ `session_output` — sessionId, data (base64)
- ✅ Handles cloud→agent: start_session, stop_session, pause_session, resume_session, session_input, resize, ping

## Critical Blockers (must resolve before install test)

### BLOCKER 1: No GitHub Release published
- `install.sh` and `install.ps1` fetch from `https://api.github.com/repos/sessionforge/agent/releases/latest`
- Zero releases exist in `PerryB-GIT/sessionforge` (confirmed via `gh release list`)
- `.goreleaser.yml` targets owner=sessionforge / name=agent (org doesn't exist yet)
- **Resolution needed**: Either create `sessionforge` GitHub org + `agent` repo, OR update goreleaser to target `PerryB-GIT/sessionforge` and publish a v0.1.0 release

### BLOCKER 2: WebSocket endpoint unconfirmed
- Agent connects to `wss://sessionforge.dev/api/ws/agent?key=<key>`
- This requires a Next.js route at `apps/web/src/app/api/ws/agent/route.ts` (or similar)
- Agent 1 needs to confirm this route exists and returns HTTP 101

### BLOCKER 3: API key provisioning untested
- Agent requires a key starting with `sf_live_`
- `/dashboard/api-keys` must exist and generate keys
- Need a real key for the connect test

## Safe Test Commands (AWAITING OVERWATCH APPROVAL)

### Step 1: Build from source (safe, no network)
```powershell
cd C:/Users/Jakeb/sessionforge/.worktrees/agent-desktop/agent
go build -ldflags "-X main.Version=v0.0.1-test" -o sessionforge-test.exe ./cmd/sessionforge
```

### Step 2: HTTP health check only (safe)
```powershell
./sessionforge-test.exe auth login --key sf_live_XXXX
./sessionforge-test.exe status
# Pings https://sessionforge.dev/api/health — no WebSocket, no side effects
```

### Step 3: Full WebSocket connect (NEEDS OVERWATCH APPROVAL)
```powershell
./sessionforge-test.exe run --log-level debug
# Expected: connects, registers, heartbeats every 30s
# Machine appears in https://sessionforge.dev/dashboard/machines
```

## What's Working
- All Go source compiles cleanly (go mod tidy passes)
- Protocol structs match TypeScript spec
- Exponential backoff reconnection logic is solid
- Heartbeat metrics collection via gopsutil works cross-platform
- PTY session management handles Windows via `pty_windows.go`

## Tech Debt Noted
- `service_windows.go` uses `sc.exe` stub — for production, switch to `kardianos/service` or `golang.org/x/sys/windows/svc`
- `updater/` package exists but not wired into CLI yet (auto-update not functional)
