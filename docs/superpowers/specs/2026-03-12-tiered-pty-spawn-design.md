# Tiered PTY Spawn for Windows Hosts

**Date:** 2026-03-12
**Status:** Approved
**Author:** Perry Bailes + Claude
**Supersedes:** ConPTY-only spawn path in `pty_windows.go`
**Related:** `docs/plans/2026-03-02-remote-session-fix-master-plan.md` (RC#1, RC#2, RC#4, RC#7)

---

## Problem Statement

Remote terminal control on Windows hosts via the SessionForge site terminal has been unreliable. The root causes stem from ConPTY's incompatibility with Go's IOCP runtime, the `LocalSystem` service context lacking user PATH/npm access, and `.cmd` shim resolution complexity. A local WSL spawn fix proved that bypassing ConPTY entirely produces reliable terminal I/O. This design generalizes that fix into a production-ready tiered spawn system.

### Why ConPTY Is Problematic

1. **Go IOCP incompatibility** — Go's runtime uses IOCP for file I/O, but anonymous pipes (used for ConPTY stdin/stdout) don't support IOCP. The codebase works around this with custom `pipeWriter`/`pipeReader` types that call `windows.WriteFile`/`windows.ReadFile` directly, bypassing Go's I/O layer entirely.
2. **`ClosePseudoConsole` hangs** — On some Windows 10 builds, `ClosePseudoConsole` blocks indefinitely. The codebase adds goroutine-based timeouts around the probe.
3. **LocalSystem service context** — The agent runs as `LocalSystem`, which has no user PATH, no npm prefix, no `USERPROFILE`. Claude Code's `.cmd` shim is invisible.
4. **`.cmd` shim parsing** — `CreateProcess` cannot execute `.cmd` files directly. The agent parses the shim to extract the real `node.exe` path and script target, adding fragile indirection.

### Why WSL Spawn Worked Locally

WSL provides a real Linux PTY (handled by the Linux kernel, not Windows ConPTY). Claude Code running inside WSL "thinks" it's on Linux — all `creack/pty`-level behavior works natively. The user's Linux-installed MCPs, tools, and scripts work without path translation.

---

## Design Decision

**Approach A: Tiered spawn with bundled Git Bash** (selected)

Three-tier cascade, auto-detected at startup. No user configuration field — the agent always picks the best available tier.

| Priority     | Tier         | Condition                                                                               | Source             |
| ------------ | ------------ | --------------------------------------------------------------------------------------- | ------------------ |
| 1 (best)     | WSL          | WSL installed + Claude Code already installed inside default distro                     | User pre-installed |
| 2 (default)  | Git Bash     | Bundled MinGit portable (~45MB) + Claude Code installed via npm at service install time | Agent distribution |
| 3 (fallback) | ConPTY/pipes | Existing code path, unchanged                                                           | Legacy             |

### Why Not WSL-Only (Approach C)?

Not all Windows hosts have WSL, and enabling it requires a reboot. We can't silently inject WSL without user action.

### Why Not Git Bash Only (Approach B)?

WSL provides superior compatibility when available — native Linux PTY, user's MCP servers and tools work natively, no path translation needed. Skipping WSL when it's present would leave value on the table.

---

## Section 1: Tier Detection & Selection

### Detection at Install Time (`sessionforge service install`)

During the existing elevated install flow in `service_windows.go`:

1. **Extract bundled Git Bash** — Unpack the portable MinGit archive from the agent distribution to `<install-dir>/gitbash/` (e.g., `C:\Users\<user>\AppData\Local\Programs\sessionforge\gitbash\`).

2. **Install Claude Code via Git Bash** — Run `<install-dir>/gitbash/bin/bash.exe -c "npm install -g @anthropic-ai/claude-code"`. This uses the host's Node.js/npm through Git Bash. Store success/failure in config.toml as `claude_installed_via = "gitbash"` (informational, not a tier override).

3. **Detect WSL + Claude** — Run `wsl --status` to check WSL availability, then `wsl -- which claude` to check if Claude Code exists inside the default WSL distro. Store the detected distro name if found.

### Detection at Agent Startup (`root.go` daemon init)

A new `detectSpawnTier()` function runs once via `sync.Once` (same pattern as `WarmUpConPTY()`):

```
detectSpawnTier():
  1. If WSL available AND `wsl -- which claude` succeeds:
       -> spawnTier = "wsl", store distro name
  2. If <install-dir>/gitbash/bin/bash.exe exists:
       a. Run `bash.exe -c "which claude"` — if found -> spawnTier = "gitbash"
       b. If not found, run `bash.exe -c "npm install -g @anthropic-ai/claude-code"` (re-install)
       c. If re-install succeeds -> spawnTier = "gitbash"
       d. If npm/node not found -> fall through
  3. Run existing ConPTY probe -> spawnTier = "conpty" or "pipes"
```

The result is stored in a package-level `spawnTier` string. The existing `spawnPTY()` function's decision tree changes from:

```go
// Before:
if conPTYWorking { spawnWithConPTY() } else { spawnWithPipes() }

// After:
switch spawnTier {
case "wsl":    spawnWithWSL(...)
case "gitbash": spawnWithGitBash(...)
default:       // existing ConPTY/pipe logic unchanged
}
```

---

## Section 2: Git Bash Spawn Implementation

### Bundled Git Bash Layout

The portable Git for Windows "MinGit" distribution (~45MB) is the right artifact. It's officially maintained by the Git project and includes bash, coreutils, and the MSYS2 runtime without the full Git GUI/installer.

Layout inside the agent install directory:

```
<install-dir>/
  sessionforge.exe
  gitbash/
    bin/
      bash.exe        <- spawn target
      sh.exe
    usr/
      bin/
        env, which, cat, grep, ...  (coreutils)
    etc/
      profile          <- minimal, sets PATH
    mingw64/
      bin/
        node.exe       <- NOT bundled, resolved from host PATH
```

### `spawnWithGitBash()` Function

New function in `pty_windows.go`. The key insight: **Git Bash's `bash.exe` is a Windows executable** — it can be spawned with `CreateProcess` using the existing pipe infrastructure. No ConPTY needed. Git Bash's MSYS2 runtime handles terminal emulation internally.

```
spawnWithGitBash(ctx, sessionID, command, args, workdir, env, outputFn, localOutputFn, exitFn):
  1. binary = <install-dir>/gitbash/bin/bash.exe
  2. bashArgs = ["-l", "-c", "claude <original-args>"]
     - "-l" = login shell (sources /etc/profile, sets up PATH)
     - "-c" = execute command string
  3. env additions:
     - TERM=xterm-256color
     - HOME=<Windows USERPROFILE path> (Git Bash auto-translates to /c/Users/...)
     - CLAUDE_CONFIG_DIR=<if configured>
     - Strip CLAUDECODE (existing logic)
  4. Spawn via CreateProcess with the SAME pipe infrastructure as spawnWithPipes()
     - No ConPTY needed — bash.exe handles VT sequences
     - Inheritable stdin/stdout/stderr pipes
     - CREATE_NO_WINDOW | DETACHED_PROCESS flags
  5. Output reader goroutine (existing readPipeOutput) works unchanged
```

### Why This Works Without ConPTY

Git Bash's `bash.exe` (built on MSYS2) includes its own terminal emulation layer. When stdin/stdout are pipes (not a console), it operates in non-interactive piped mode but still processes ANSI/VT escape sequences. Claude Code detects `TERM=xterm-256color` and emits VT sequences. The output flows through the pipes to our reader, then to xterm.js in the browser — which is itself a VT terminal emulator.

The chain: Claude Code -> VT sequences -> bash.exe pipes -> agent reader -> base64 -> WebSocket -> xterm.js

### Resize Handling

Set `COLUMNS` and `LINES` env vars at spawn time based on the terminal dimensions from the dashboard's first resize message. Mid-session resize is a known limitation of the Git Bash tier. WSL and ConPTY both support true resize.

---

## Section 3: WSL Spawn Implementation

### Detection

```
detectWSL():
  1. exec.Command("wsl", "--status") — must exit 0
  2. exec.Command("wsl", "--list", "--quiet") — parse to get default distro name
  3. exec.Command("wsl", "-d", <distro>, "--", "which", "claude") — must exit 0 and return a path
  If all three pass -> WSL tier available, store distro name
```

Each step has a 5-second timeout. If any step fails or times out, WSL tier is skipped.

### `spawnWithWSL()` Function

New function in `pty_windows.go`:

```
spawnWithWSL(ctx, sessionID, command, args, workdir, env, outputFn, localOutputFn, exitFn):
  1. binary = "wsl.exe" (resolved via exec.LookPath)
  2. wslArgs = ["-d", <distro>, "--", "claude", <original-args>]
  3. workdir translation:
     - Windows "C:\Users\Jakeb\project" -> WSL "/mnt/c/Users/Jakeb/project"
     - Simple string replacement: drive letter -> /mnt/<lowercase letter>/
     - Pass via: wsl -d <distro> --cd <wsl-path> -- claude
  4. env: WSL inherits Windows env vars by default (WSLENV controls this)
     - Set TERM=xterm-256color
     - Strip CLAUDECODE
     - Claude Code inside WSL finds its own ~/.claude/ config naturally
  5. Spawn via CreateProcess with pipes (same as Git Bash — wsl.exe is a Windows binary)
  6. Output reader goroutine works unchanged
```

### Resize Handling

WSL spawned via pipes has the same limitation as Git Bash — no `SIGWINCH` delivery through Windows pipes to the WSL process. Set `COLUMNS`/`LINES` at spawn time.

Future optimization: spawn `wsl.exe` attached to a ConPTY (since `wsl.exe` is a regular Windows process). The ConPTY resize would propagate through to the Linux PTY inside WSL. Not needed for v1.

### What WSL Tier Gives You Over Git Bash

- Native Linux PTY semantics inside the WSL distro (Claude Code "thinks" it's on Linux)
- User's Linux-installed MCPs, tools, and scripts work natively
- Better compatibility with Claude Code features that assume a Unix environment
- `creack/pty`-level behavior without Go IOCP issues (the Linux kernel handles the PTY)

---

## Section 4: Integration Points & Changes to Existing Code

### Files Modified

| File                                    | Change                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `agent/internal/session/pty_windows.go` | Add `spawnWithWSL()`, `spawnWithGitBash()`. Modify `spawnPTY()` to use tier switch. Existing ConPTY/pipe code untouched. |
| `agent/internal/session/pty_unix.go`    | No changes. Unix path stays as-is.                                                                                       |
| `agent/internal/session/manager.go`     | No changes. Manager calls `spawnPTY()` which internally routes to the right tier.                                        |
| `agent/internal/cli/service_windows.go` | Add Git Bash extraction + Claude install during `sessionforge service install`.                                          |
| `agent/internal/cli/root.go`            | Replace `go session.WarmUpConPTY()` with `go session.WarmUpSpawnTier()` which runs full detection cascade.               |
| `agent/internal/config/config.go`       | No changes (no new config fields — auto-detect only).                                                                    |

### Files Added

| File                                     | Purpose                                                                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/internal/session/tier_windows.go` | Detection logic: `detectSpawnTier()`, `detectWSL()`, `detectGitBash()`, `ensureClaudeInGitBash()`. Separated from pty_windows.go to keep that file focused on spawning. |
| `agent/internal/session/tier_stub.go`    | Build-tagged `!windows` stub — always returns "unix" tier (no-op, Unix path unchanged).                                                                                 |

### What Does NOT Change

- `pty_unix.go` — completely untouched
- `manager.go` — `Start()` and `StartWithLocalOutput()` still call `spawnPTY()` with the same signature
- `connection/handler.go` — message dispatch unchanged
- `connection/client.go` — WebSocket client unchanged
- `server.js` — relay server unchanged
- `Terminal.tsx` — xterm.js component unchanged
- The entire output pipeline (base64 -> WebSocket -> Redis -> dashboard) — unchanged

### Key Principle: Same Interface, Different Backend

The `spawnPTY()` function signature stays identical:

```go
func spawnPTY(ctx, sessionID, command, workdir, env, outputFn, localOutputFn, exitFn) (*ptyHandle, int, error)
```

All three tiers return the same `*ptyHandle` struct. The `ptyHandle` methods (`writeInput`, `writeInputRaw`, `resize`, `stop`, `close`) work the same regardless of which tier created the handle. The rest of the codebase never knows which tier is running.

### Agent Log Observability

The detection result is logged at startup:

```
INFO spawn tier detected  tier=gitbash  wsl_available=false  conpty_available=true
INFO spawn tier detected  tier=wsl      distro=Ubuntu  wsl_claude=/usr/local/bin/claude
```

And each session spawn logs the tier used:

```
INFO session started  sessionId=abc123  tier=gitbash  pid=12345
```

---

## Section 5: Git Bash Bundling & Distribution

### MinGit Portable

The official [Git for Windows MinGit](https://github.com/git-for-windows/git/releases) distribution. ~45MB zipped, includes:

- `bash.exe` + MSYS2 runtime
- Coreutils (which, env, cat, grep, etc.)
- No GUI, no installer, no context menu integration

### Distribution Strategy

Embed in GoReleaser build artifact. The release CI (`.github/workflows/release-agent.yml`) downloads MinGit during build, extracts it, and includes it in the release zip alongside `sessionforge.exe`.

```
sessionforge-windows-amd64.zip
  sessionforge.exe       (~15MB)
  gitbash/               (~45MB extracted)
    bin/bash.exe
    usr/bin/...
    etc/profile
    mingw64/...
```

The install script (`install.sh` / `install.ps1`) extracts both the binary and the gitbash directory to `<install-dir>`.

### First-Run Claude Install

During `sessionforge service install` (already elevated):

```go
// In service_windows.go, after extracting gitbash/
gitBash := filepath.Join(installDir, "gitbash", "bin", "bash.exe")
cmd := exec.Command(gitBash, "-l", "-c", "npm install -g @anthropic-ai/claude-code")
cmd.Env = buildUserEnv() // inherit user's PATH with node/npm
err := cmd.Run()
```

If npm/node aren't found, log a warning but don't fail the install — the startup probe will catch this and fall through to ConPTY.

### Size Budget

| Component         | Size              |
| ----------------- | ----------------- |
| sessionforge.exe  | ~15MB             |
| MinGit portable   | ~45MB (extracted) |
| **Total install** | **~60MB**         |

---

## Section 6: Error Handling & Graceful Degradation

### Tier Cascade on Failure

Each tier can fail at two points: **detection time** (startup) and **spawn time** (session request).

**Detection failure** (startup probe):

- Tier is skipped, next tier is tried
- Logged as `WARN` with the specific error
- No user-visible impact — the agent picks the best available tier

**Spawn failure** (session request):

- The selected tier's `spawnWith*()` function returns an error
- `spawnPTY()` does NOT automatically fall through to the next tier
- Returns the error to the Manager, which sends `session_crashed` to the cloud
- Rationale: if the detected tier worked during the probe but fails at spawn time, something unexpected happened. Silently falling through could mask bugs and produce a worse experience (e.g., ConPTY with no output).

```go
func spawnPTY(...) (*ptyHandle, int, error) {
    switch spawnTier {
    case "wsl":
        return spawnWithWSL(...)
    case "gitbash":
        return spawnWithGitBash(...)
    default:
        if conPTYWorking {
            return spawnWithConPTY(...)
        }
        return spawnWithPipes(...)
    }
}
```

### Specific Failure Modes

| Failure                                      | Detection                              | Handling                                                                  |
| -------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| WSL installed but no distro                  | `wsl --list --quiet` returns empty     | Skip WSL tier                                                             |
| WSL distro exists but `claude` not found     | `wsl -- which claude` exits non-zero   | Skip WSL tier                                                             |
| WSL hangs during detection                   | 5s timeout on each command             | Skip WSL tier, log timeout                                                |
| Git Bash `bash.exe` missing from install dir | `os.Stat()` fails                      | Skip Git Bash tier, log error                                             |
| Git Bash `npm install` fails (no node/npm)   | Non-zero exit from install command     | Skip Git Bash tier, log stderr                                            |
| Git Bash `claude` not found after install    | `bash -c "which claude"` fails         | Skip Git Bash tier                                                        |
| ConPTY probe fails                           | Existing `probeConPTY()` returns false | Fall to pipes (existing behavior)                                         |
| All tiers fail                               | No working spawn method                | Agent starts but sessions return `session_crashed` with descriptive error |

### Startup Log Output

Clear, single-line summary for support diagnostics:

```
INFO spawn tier detection complete  selected=gitbash  wsl=unavailable  gitbash=ready  conpty=available
INFO spawn tier detection complete  selected=wsl  distro=Ubuntu  wsl_claude=/usr/local/bin/claude  gitbash=ready  conpty=available
WARN spawn tier detection complete  selected=conpty  wsl=unavailable  gitbash=no_npm  conpty=available
```

---

## Open Questions / Future Work

1. **Mid-session resize for Git Bash/WSL** — Currently set `COLUMNS`/`LINES` at spawn time only. Could use ConPTY-attached `wsl.exe` for WSL resize support in a future version.
2. **Auto-install Claude Code inside WSL** — Currently WSL tier requires Claude Code to already be installed in the distro. Could add auto-install in a future version, but this changes the user's WSL environment which is more invasive.
3. **Git Bash PATH inheritance** — Verify that `bash -l` correctly picks up the host's `node`/`npm` from the Windows PATH in all scenarios (including LocalSystem context where PATH is injected).
4. **MinGit version pinning** — Pin the MinGit version in CI to ensure reproducible builds.
