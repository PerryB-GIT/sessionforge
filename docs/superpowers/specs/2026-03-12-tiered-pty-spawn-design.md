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

Each npm install step has a **60-second timeout** to prevent blocking session spawns. The `detectSpawnTier()` function runs in a background goroutine; `spawnPTY()` waits on a `sync.Once`-guarded result with a 90-second overall timeout.

**Startup detection is authoritative.** Install-time config entries (`claude_installed_via`) are purely informational/diagnostic. If WSL was available at install time but removed before next startup, the startup detection correctly falls through.

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

### Command String Handling Per Tier

The `command` parameter passed to `spawnPTY()` may contain arguments (e.g., `"claude --profile work"`). Each tier handles this differently:

- **WSL/Git Bash:** The entire command string is passed as a single argument to `sh -c` or `bash -c`, which handles word splitting natively. No splitting needed in Go.
- **ConPTY/Pipes:** The existing `resolveCommand()` calls `strings.Fields(command)` to split the command, then resolves the binary path. This behavior is unchanged.

### `resolveCommand` Bypass

The existing `resolveCommand()` function (which resolves `claude` to a Windows `.cmd` shim path and parses it for `node.exe`) is **only called in the `default` (ConPTY/pipes) branch**. The WSL and Git Bash tiers skip `resolveCommand` entirely — they pass the raw command string (`"claude"`) to their respective shell environments, which handle PATH resolution natively.

```go
func spawnPTY(...) (*ptyHandle, int, error) {
    switch spawnTier {
    case "wsl":
        // No resolveCommand — WSL's shell resolves "claude" via Linux PATH
        return spawnWithWSL(...)
    case "gitbash":
        // No resolveCommand — bash -l -c resolves "claude" via Git Bash PATH
        return spawnWithGitBash(...)
    default:
        // Only the ConPTY/pipes path needs Windows-specific command resolution
        binary, args, err := resolveCommand(command)
        if err != nil { return nil, 0, err }
        // ... existing ConPTY/pipe logic
    }
}
```

### `configuredClaudePath` Interaction

The `configuredClaudePath` package-level variable (set from `config.toml`'s `claude_path`) is **only used by `resolveCommand()`**, which is only called in the ConPTY/pipes fallback path. The WSL and Git Bash tiers ignore it entirely — they rely on their respective shell environments to find `claude` on PATH.

### `WarmUpSpawnTier()` Definition

Replaces the existing `WarmUpConPTY()` call in `root.go`:

```go
// Package-level state — replaces the existing conPTYWorkingOnce/conPTYWorking pair.
var (
    tierOnce  sync.Once
    spawnTier string // "wsl", "gitbash", "conpty", or "pipes"
    // conPTYWorking is still set during detection for the default tier's sub-decision.
)

func WarmUpSpawnTier() {
    tierOnce.Do(func() {
        // 1. Try WSL (detectWSL with 5s per-step timeouts)
        // 2. Try Git Bash (detectGitBash, with 60s npm install timeout if needed)
        // 3. Fall back to ConPTY probe:
        //    - Calls existing probeConPTY() internally
        //    - Sets conPTYWorking = true/false (used by default branch in spawnPTY)
        //    - Sets spawnTier = "conpty" or "pipes" based on probe result
    })
}
```

**Relationship to existing `conPTYWorkingOnce`:** The new `tierOnce` **replaces** `conPTYWorkingOnce` entirely. The existing `conPTYWorkingOnce.Do(probeConPTY)` call is removed; `probeConPTY()` is called directly inside `tierOnce.Do()` as step 3 of the cascade. The `conPTYWorking` boolean is still set by `probeConPTY()` and still read by the `default` branch of `spawnPTY()` to decide between ConPTY and pipes. This means:

- `WarmUpConPTY()` is deleted (replaced by `WarmUpSpawnTier()`)
- `conPTYWorkingOnce` is deleted (replaced by `tierOnce`)
- `conPTYWorking` is **kept** (set inside `tierOnce.Do`, read by `spawnPTY`'s default branch)
- The `root.go` call changes from `go session.WarmUpConPTY()` to `go session.WarmUpSpawnTier()`

Called as `go session.WarmUpSpawnTier()` in `root.go` daemon init. The `sync.Once` ensures it runs exactly once even if called from multiple goroutines.

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

### Forcing TTY Mode in Piped Context

**Critical:** When stdin/stdout are pipes (not a console/PTY), Node.js's `process.stdout.isTTY` returns `false`. Claude Code may detect this and disable interactive terminal output (no colors, no TUI, no progress bars). The Git Bash tier must force Claude Code into TTY-compatible mode.

Required env vars set at spawn time:

```
FORCE_COLOR=1          # Forces Node.js color output regardless of isTTY
TERM=xterm-256color    # Signals VT-256color capability
COLUMNS=<cols>         # Terminal width (from dashboard resize)
LINES=<rows>           # Terminal height (from dashboard resize)
```

Additionally, the spawn command wraps Claude Code with the `script` utility (available in MSYS2 coreutils) to create a pseudo-TTY layer:

```
bash -l -c "script -qfc 'claude <args>' /dev/null"
```

The `script` command allocates a PTY inside Git Bash, making `process.stdout.isTTY` return `true` in the spawned process. This is the standard Unix technique for forcing TTY mode in piped contexts, and it works in MSYS2's bash.

**If `script` is not available in MinGit** (validation required during implementation), fall back to `FORCE_COLOR=1` + `TERM=xterm-256color` and accept potential TUI degradation.

The output chain: Claude Code -> VT sequences -> script PTY -> bash.exe pipes -> agent reader -> base64 -> WebSocket -> xterm.js

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
  2. wslArgs = ["-d", <distro>, "--", "sh", "-c", "cd <wsl-path> && exec claude <original-args>"]
     Note: Using "sh -c" with "cd" instead of "--cd" flag for WSL version compatibility.
     The "--cd" flag was introduced in WSL 0.67.6 (2022) and may not be available on older installs.
  3. workdir translation:
     - Windows "C:\Users\Jakeb\project" -> WSL "/mnt/c/Users/Jakeb/project"
     - Translation steps:
       a. Replace all backslashes with forward slashes
       b. Extract drive letter, convert to lowercase
       c. Replace "C:/" with "/mnt/c/"
     - UNC paths (\\server\share) are NOT supported — fall through to Git Bash tier if workdir is UNC
  4. env: WSL inherits Windows env vars by default (WSLENV controls this)
     - Set TERM=xterm-256color
     - Set FORCE_COLOR=1
     - Strip CLAUDECODE
     - Claude Code inside WSL finds its own ~/.claude/ config naturally
  5. Spawn via CreateProcess with pipes (same as Git Bash — wsl.exe is a Windows binary)
  6. Output reader goroutine works unchanged
```

### Process Termination in WSL

Killing `wsl.exe` (the host-side process) does NOT reliably propagate the kill signal to the Linux process inside WSL. The `stop()` method for WSL-spawned sessions must:

**PID capture via sideband file** (avoids mixing PID into the output pipe):

At spawn time, `spawnWithWSL()` generates a temp file path: `/tmp/sf-<sessionID>.pid`. The shell command becomes:

```
sh -c "echo $$ > /tmp/sf-<sessionID>.pid && exec claude <args>"
```

After `CreateProcess` returns, the agent reads the PID via a separate, short-lived command:

```
wsl -d <distro> -- cat /tmp/sf-<sessionID>.pid
```

This runs in a goroutine with a 3-second timeout. If it fails, `linuxPID` stays 0 and the WSL tier falls back to killing the host-side `wsl.exe` process directly (less clean but functional). The temp file is cleaned up in `close()` via `wsl -d <distro> -- rm -f /tmp/sf-<sessionID>.pid`.

**Why sideband, not stdout parsing:** The `echo $$ && exec claude` approach sends the PID into the same pipe that carries Claude Code's output. Parsing the first line requires a buffered reader with a delimiter, races with Claude's own startup output, and complicates the `readPipeOutput` goroutine. A temp file keeps the output pipe clean and requires no changes to the output reader.

**Stop behavior per tier:**

1. **Graceful stop (force=false):** Send `wsl -d <distro> -- kill -TERM <linux-pid>` if `linuxPID > 0`. If `linuxPID == 0` (PID capture failed), send Ctrl+C (`\x03`) to the stdin pipe.
2. **Force stop (force=true):** Send `wsl -d <distro> -- kill -9 <linux-pid>`, then kill the host-side `wsl.exe` process as a fallback.
3. **Cleanup:** The `close()` method kills the host-side process unconditionally to prevent orphaned `wsl.exe` instances, and removes the PID temp file.

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

**New `ptyHandle` fields for WSL tier:**

```go
type ptyHandle struct {
    // ... existing fields (hPC, proc, stdinPipe, cancel, etc.)
    tier      string // "wsl", "gitbash", "conpty", "pipes"
    wslDistro string // WSL distro name (only set for WSL tier)
    linuxPID  int    // Linux-side PID (only set for WSL tier, 0 if capture failed)
    sessionID string // For temp file cleanup in WSL tier
}
```

The `tier` field is set at construction time by each `spawnWith*()` function and drives the per-tier `stop()` and `resize()` behavior.

**Per-tier `resize()` behavior:** The existing `ptyHandle.resize()` checks `if h.hPC == 0` (no ConPTY handle) and no-ops. For WSL and Git Bash tiers, `hPC` is always 0 (no ConPTY involved), so `resize()` is a no-op. The Manager's `Resize()` call (line 364 of `manager.go`) continues to work — it just silently does nothing for non-ConPTY tiers. A `DEBUG`-level log message is added so operators can see resize calls being received but not applied.

**Per-tier `stop()` behavior:**

> **Implementation note:** The existing `pty_windows.go` `stop()` method currently discards the `force` parameter (declared as `_ bool`). This must be refactored as part of this work: rename the parameter to `force bool` and implement per-tier behavior.

- **ConPTY tier (force=false):** Write Ctrl+C (`\x03`) to stdin pipe for graceful shutdown. **(force=true):** Call `proc.Kill()`.
- **Git Bash tier (force=false):** Write Ctrl+C (`\x03`) to stdin pipe. **(force=true):** Call `proc.Kill()`.
- **WSL tier:** Uses WSL-specific kill mechanism (see Section 3 — Process Termination in WSL).
- **Pipe tier (force=false):** Write Ctrl+C to stdin. **(force=true):** Call `proc.Kill()`.

The Manager's `StopAll()` (line 421-430 of `manager.go`) calls `stop(false)` then `stop(true)` as a fallback — this pattern works correctly with all tiers once the parameter is no longer discarded.

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

## Implementation Prerequisites

These must be validated before implementation begins:

1. **Git Bash PATH inheritance under LocalSystem** — The agent service runs as `LocalSystem`, which has a minimal PATH. During `sessionforge service install` (elevated, user context), the install captures the user's PATH and injects it into the service's environment via `buildUserEnv()`. Verify that `bash -l` inside Git Bash correctly picks up the host's `node`/`npm` from this injected PATH. If not, the Git Bash tier's Claude install and all subsequent spawns fail. **Mitigation if PATH injection fails:** The install flow should capture `where node` and `where npm` at install time and write the absolute paths into a Git Bash `~/.bashrc` or `/etc/profile.d/` snippet.

2. **MinGit `script` command availability** — Verify that the MinGit portable distribution includes `script` (from util-linux) in `usr/bin/`. If not, the TTY-forcing technique described in Section 2 falls back to `FORCE_COLOR=1` env var only, which may cause degraded TUI experience in Claude Code.

3. **MinGit version and architecture** — Bundle the 64-bit MinGit (matching the `windows-amd64` agent build). Pin a specific MinGit release version in CI for reproducible builds. ARM64 Windows is not supported in v1.

## Future Work

1. **Mid-session resize for Git Bash/WSL** — Currently set `COLUMNS`/`LINES` at spawn time only. Could use ConPTY-attached `wsl.exe` for WSL resize support in a future version.
2. **Auto-install Claude Code inside WSL** — Currently WSL tier requires Claude Code to already be installed in the distro. Could add auto-install in a future version, but this changes the user's WSL environment which is more invasive.
3. **WSL 1 vs WSL 2 detection** — Both return success from `wsl --status`, but WSL 1 has known PTY I/O issues. A future version could detect and prefer WSL 2 explicitly.
