# Tiered PTY Spawn Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ConPTY-only Windows PTY spawn with a three-tier cascade (WSL > Git Bash > ConPTY/pipes) that auto-detects the best available backend at startup.

**Architecture:** A new `tier_windows.go` file handles tier detection via `sync.Once`. The existing `spawnPTY()` in `pty_windows.go` gains a `switch` on the detected tier, routing to new `spawnWithWSL()` / `spawnWithGitBash()` functions or the existing ConPTY/pipe path. The `ptyHandle` struct gains tier-aware fields so `stop()`, `close()`, and `resize()` dispatch correctly. CI bundles MinGit portable alongside the binary, and the install script extracts it.

**Tech Stack:** Go 1.22+, `golang.org/x/sys/windows`, Windows `CreateProcess` API, MinGit portable (~45MB), WSL CLI (`wsl.exe`)

**Spec:** `docs/superpowers/specs/2026-03-12-tiered-pty-spawn-design.md` (approved)

---

## File Structure

### New Files

| File                                                   | Responsibility                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/internal/session/tier_windows.go`               | `detectSpawnTier()`, `detectWSL()`, `detectGitBash()`, `ensureClaudeInGitBash()`, `WarmUpSpawnTier()`, package-level `tierOnce`/`spawnTier` state |
| `agent/internal/session/tier_stub.go`                  | Build-tagged `//go:build !windows` — exports no-op `WarmUpSpawnTier()` so Unix builds compile                                                     |
| `agent/internal/session/tier_windows_test.go`          | Unit tests for tier detection logic                                                                                                               |
| `agent/internal/session/spawn_wsl_windows.go`          | `spawnWithWSL()` function — isolated for clarity                                                                                                  |
| `agent/internal/session/spawn_gitbash_windows.go`      | `spawnWithGitBash()` function — isolated for clarity                                                                                              |
| `agent/internal/session/spawn_wsl_windows_test.go`     | Integration test for WSL spawn (skipped if no WSL)                                                                                                |
| `agent/internal/session/spawn_gitbash_windows_test.go` | Integration test for Git Bash spawn (skipped if no bash.exe)                                                                                      |

### Modified Files

| File                                    | Change                                                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/internal/session/pty_windows.go` | Add `tier`/`wslDistro`/`linuxPID`/`sessionID` to `ptyHandle`; refactor `stop()`, `close()`, `resize()` for tier dispatch; modify `spawnPTY()` to switch on `spawnTier`; delete `WarmUpConPTY()` and `conPTYWorkingOnce` |
| `agent/internal/cli/root.go`            | Replace `go session.WarmUpConPTY()` with `go session.WarmUpSpawnTier()`                                                                                                                                                 |
| `agent/internal/cli/service_windows.go` | Add Git Bash extraction + Claude Code npm install during `sessionforge service install`                                                                                                                                 |
| `.github/workflows/release-agent.yml`   | Download MinGit during build, bundle in release zip                                                                                                                                                                     |
| `agent/scripts/install.ps1`             | Extract `gitbash/` directory alongside binary                                                                                                                                                                           |

### Unchanged Files (for reference)

| File                                 | Why unchanged                           |
| ------------------------------------ | --------------------------------------- |
| `agent/internal/session/pty_unix.go` | Unix path is completely separate        |
| `agent/internal/session/manager.go`  | Calls `spawnPTY()` — same signature     |
| `agent/internal/session/registry.go` | Pure data store — no spawn logic        |
| `agent/internal/config/config.go`    | No new config fields (auto-detect only) |

---

## Chunk 1: Tier Detection Foundation

### Task 1: Create `tier_stub.go` (Unix no-op)

**Files:**

- Create: `agent/internal/session/tier_stub.go`

- [ ] **Step 1: Write the stub file**

```go
// agent/internal/session/tier_stub.go
//go:build !windows

package session

// WarmUpSpawnTier is a no-op on non-Windows platforms.
// The Unix path uses creack/pty directly and has no tier detection.
func WarmUpSpawnTier() {}
```

- [ ] **Step 2: Verify Unix build still compiles**

Run: `cd C:\Users\Jakeb\sessionforge\agent && GOOS=linux GOARCH=amd64 go build ./...`
Expected: PASS (no compile errors)

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/tier_stub.go
git commit -m "feat(session): add tier_stub.go for Unix build compatibility"
```

---

### Task 2: Create `tier_windows.go` with detection skeleton

**Files:**

- Create: `agent/internal/session/tier_windows.go`

- [ ] **Step 1: Write the failing test**

Create `agent/internal/session/tier_windows_test.go`:

```go
//go:build windows

package session

import (
	"testing"
)

func TestDetectSpawnTier_ReturnsNonEmpty(t *testing.T) {
	// detectSpawnTier should always return a valid tier, even if all
	// tiers fail — the fallback is "conpty" or "pipes".
	tier := detectSpawnTier()
	if tier == "" {
		t.Fatal("detectSpawnTier returned empty string; expected one of: wsl, gitbash, conpty, pipes")
	}
	validTiers := map[string]bool{"wsl": true, "gitbash": true, "conpty": true, "pipes": true}
	if !validTiers[tier] {
		t.Fatalf("detectSpawnTier returned %q; expected one of: wsl, gitbash, conpty, pipes", tier)
	}
}

func TestDetectWSL_DoesNotPanic(t *testing.T) {
	// detectWSL should not panic regardless of WSL availability.
	// It returns (distro, true) or ("", false).
	distro, ok := detectWSL()
	t.Logf("detectWSL: distro=%q ok=%v", distro, ok)
	if ok && distro == "" {
		t.Fatal("detectWSL returned ok=true but empty distro")
	}
}

func TestDetectGitBash_DoesNotPanic(t *testing.T) {
	// detectGitBash should not panic regardless of Git Bash availability.
	bashPath, ok := detectGitBash()
	t.Logf("detectGitBash: bashPath=%q ok=%v", bashPath, ok)
	if ok && bashPath == "" {
		t.Fatal("detectGitBash returned ok=true but empty bashPath")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -run TestDetectSpawnTier -v -count=1`
Expected: FAIL — `detectSpawnTier`, `detectWSL`, `detectGitBash` undefined

- [ ] **Step 3: Write `tier_windows.go`**

```go
// agent/internal/session/tier_windows.go
//go:build windows

package session

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ── Package-level tier state ────────────────────────────────────────────────

// tierOnce replaces the old conPTYWorkingOnce. It runs the full detection
// cascade exactly once: WSL → Git Bash → ConPTY probe → pipes.
var (
	tierOnce  sync.Once
	spawnTier string // "wsl", "gitbash", "conpty", or "pipes"

	// WSL-specific state (set during detection, read during spawn).
	detectedWSLDistro string

	// Git Bash path (set during detection, read during spawn).
	detectedGitBashPath string // absolute path to bash.exe
)

// WarmUpSpawnTier runs the tier detection cascade in the background.
// Called as `go session.WarmUpSpawnTier()` in root.go at daemon startup.
// The sync.Once ensures it runs exactly once even if called from multiple goroutines.
func WarmUpSpawnTier() {
	tierOnce.Do(runTierDetection)
}

// ensureTierDetected is called by spawnPTY to guarantee detection has run.
// If WarmUpSpawnTier was called at startup (normal path), this is a no-op.
func ensureTierDetected() {
	tierOnce.Do(runTierDetection)
}

// runTierDetection is the core cascade. Called exactly once via tierOnce.
func runTierDetection() {
	logger := conPTYWorkingLogger // reuse the existing logger set by SetConPTYLogger

	// Step 1: Try WSL
	if distro, ok := detectWSL(); ok {
		spawnTier = "wsl"
		detectedWSLDistro = distro
		if logger != nil {
			logger.Info("spawn tier detection complete",
				"selected", "wsl",
				"distro", distro,
				"wsl", "available",
				"gitbash", "skipped",
				"conpty", "skipped",
			)
		}
		return
	}

	// Step 2: Try Git Bash
	if bashPath, ok := detectGitBash(); ok {
		spawnTier = "gitbash"
		detectedGitBashPath = bashPath
		if logger != nil {
			logger.Info("spawn tier detection complete",
				"selected", "gitbash",
				"wsl", "unavailable",
				"gitbash", "ready",
				"conpty", "skipped",
			)
		}
		return
	}

	// Step 3: ConPTY probe (existing logic)
	conPTYWorking = probeConPTY()
	if conPTYWorking {
		spawnTier = "conpty"
	} else {
		spawnTier = "pipes"
	}

	if logger != nil {
		tier := spawnTier
		logger.Info("spawn tier detection complete",
			"selected", tier,
			"wsl", "unavailable",
			"gitbash", "unavailable",
			"conpty", fmt.Sprintf("%v", conPTYWorking),
		)
	}
}

// ── WSL Detection ───────────────────────────────────────────────────────────

// detectWSL checks if WSL is available and Claude Code is installed inside
// the default distro. Returns (distro_name, true) on success.
func detectWSL() (string, bool) {
	logger := conPTYWorkingLogger

	// 1. wsl --status must exit 0
	ctx1, cancel1 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel1()
	if out, err := exec.CommandContext(ctx1, "wsl", "--status").CombinedOutput(); err != nil {
		if logger != nil {
			logger.Debug("WSL detection: --status failed", "err", err, "output", string(out))
		}
		return "", false
	}

	// 2. wsl --list --quiet — parse first line for default distro
	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()
	out, err := exec.CommandContext(ctx2, "wsl", "--list", "--quiet").CombinedOutput()
	if err != nil {
		if logger != nil {
			logger.Debug("WSL detection: --list failed", "err", err)
		}
		return "", false
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) == "" {
		if logger != nil {
			logger.Debug("WSL detection: no distros found")
		}
		return "", false
	}
	// Remove BOM and null bytes that WSL sometimes includes in output.
	distro := strings.TrimSpace(lines[0])
	distro = strings.ReplaceAll(distro, "\x00", "")
	distro = strings.TrimLeft(distro, "\ufeff")
	distro = strings.TrimSpace(distro)
	if distro == "" {
		return "", false
	}

	// 3. Check claude is installed inside the distro
	ctx3, cancel3 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel3()
	claudeOut, err := exec.CommandContext(ctx3, "wsl", "-d", distro, "--", "which", "claude").CombinedOutput()
	if err != nil {
		if logger != nil {
			logger.Debug("WSL detection: claude not found in distro", "distro", distro, "err", err)
		}
		return "", false
	}
	claudePath := strings.TrimSpace(string(claudeOut))
	if claudePath == "" {
		return "", false
	}

	if logger != nil {
		logger.Info("WSL detection: claude found", "distro", distro, "claudePath", claudePath)
	}
	return distro, true
}

// ── Git Bash Detection ──────────────────────────────────────────────────────

// detectGitBash checks if the bundled Git Bash exists and Claude Code is
// available via it. Returns (bash_exe_path, true) on success.
func detectGitBash() (string, bool) {
	logger := conPTYWorkingLogger

	// Locate the bundled bash.exe next to the agent binary.
	bashPath := gitBashPath()
	if _, err := os.Stat(bashPath); err != nil {
		if logger != nil {
			logger.Debug("Git Bash detection: bash.exe not found", "path", bashPath, "err", err)
		}
		return "", false
	}

	// Check if claude is available via Git Bash.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bashPath, "-l", "-c", "which claude").CombinedOutput()
	if err != nil {
		if logger != nil {
			logger.Debug("Git Bash detection: claude not found, attempting install", "err", err, "output", string(out))
		}
		// Try installing Claude Code via npm.
		if ensureClaudeInGitBash(bashPath) {
			return bashPath, true
		}
		return "", false
	}

	claudePath := strings.TrimSpace(string(out))
	if logger != nil {
		logger.Info("Git Bash detection: claude found", "bashPath", bashPath, "claudePath", claudePath)
	}
	return bashPath, true
}

// ensureClaudeInGitBash attempts to install Claude Code via npm inside Git Bash.
// Returns true if the install succeeds and `which claude` passes afterwards.
func ensureClaudeInGitBash(bashPath string) bool {
	logger := conPTYWorkingLogger

	// 60-second timeout for npm install.
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, bashPath, "-l", "-c", "npm install -g @anthropic-ai/claude-code")
	out, err := cmd.CombinedOutput()
	if err != nil {
		if logger != nil {
			logger.Warn("Git Bash: npm install claude-code failed",
				"err", err,
				"output", string(out),
			)
		}
		return false
	}

	// Verify claude is now available.
	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()
	if _, err := exec.CommandContext(ctx2, bashPath, "-l", "-c", "which claude").CombinedOutput(); err != nil {
		if logger != nil {
			logger.Warn("Git Bash: claude not found after npm install", "err", err)
		}
		return false
	}

	if logger != nil {
		logger.Info("Git Bash: claude installed successfully via npm")
	}
	return true
}

// gitBashPath returns the expected path to the bundled bash.exe.
// Layout: <install-dir>/gitbash/bin/bash.exe (same dir as sessionforge.exe).
func gitBashPath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	installDir := filepath.Dir(exe)
	return filepath.Join(installDir, "gitbash", "bin", "bash.exe")
}

// windowsToWSLPath converts a Windows path like "C:\Users\Jakeb\project"
// to a WSL path like "/mnt/c/Users/Jakeb/project".
// Returns ("", false) if the path is a UNC path or cannot be converted.
func windowsToWSLPath(winPath string) (string, bool) {
	// Reject UNC paths (\\server\share).
	if strings.HasPrefix(winPath, `\\`) {
		return "", false
	}

	// Normalize backslashes to forward slashes.
	p := strings.ReplaceAll(winPath, `\`, "/")

	// Extract drive letter: "C:/Users/..." -> "c", "/Users/..."
	if len(p) >= 2 && p[1] == ':' {
		drive := strings.ToLower(string(p[0]))
		rest := p[2:] // "/Users/..."
		return "/mnt/" + drive + rest, true
	}

	// Already a unix-style path or relative — return as-is.
	return p, true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -run "TestDetect" -v -count=1`
Expected: PASS — all three tests pass (with varying detected tiers depending on the machine)

- [ ] **Step 5: Run full build to verify no compile errors**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/tier_windows.go internal/session/tier_windows_test.go
git commit -m "feat(session): add tier detection cascade (WSL > Git Bash > ConPTY)"
```

---

### Task 3: Add `windowsToWSLPath` unit tests

**Files:**

- Modify: `agent/internal/session/tier_windows_test.go`

- [ ] **Step 1: Write path conversion tests**

Append to `tier_windows_test.go`:

```go
func TestWindowsToWSLPath(t *testing.T) {
	tests := []struct {
		input   string
		want    string
		wantOK  bool
	}{
		{`C:\Users\Jakeb\project`, "/mnt/c/Users/Jakeb/project", true},
		{`D:\code`, "/mnt/d/code", true},
		{`C:/Users/Jakeb`, "/mnt/c/Users/Jakeb", true},
		{`\\server\share`, "", false},       // UNC path — unsupported
		{`/some/unix/path`, "/some/unix/path", true}, // already unix
	}
	for _, tc := range tests {
		got, ok := windowsToWSLPath(tc.input)
		if ok != tc.wantOK {
			t.Errorf("windowsToWSLPath(%q): ok=%v, want %v", tc.input, ok, tc.wantOK)
			continue
		}
		if got != tc.want {
			t.Errorf("windowsToWSLPath(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
```

- [ ] **Step 2: Run the test**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -run TestWindowsToWSLPath -v -count=1`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/tier_windows_test.go
git commit -m "test(session): add windowsToWSLPath unit tests"
```

---

## Chunk 2: ptyHandle Refactoring & spawnPTY Routing

### Task 4: Add tier fields to `ptyHandle` struct

**Files:**

- Modify: `agent/internal/session/pty_windows.go:86-94`

- [ ] **Step 1: Update `ptyHandle` struct**

In `pty_windows.go`, replace the existing `ptyHandle` struct (lines 86-94):

```go
// ptyHandle wraps a Windows ConPTY pseudo-console and its child process.
// In pipe-fallback mode (Windows < 1809) cmd is set and hPC is zero.
// The tier field indicates which spawn backend created this handle.
type ptyHandle struct {
	hPC    windows.Handle // ConPTY handle (0 in pipe-fallback, WSL, and Git Bash modes)
	proc   *os.Process    // child process (ConPTY / WSL / Git Bash path)
	cmd    *exec.Cmd      // child process (pipe-fallback path — legacy)
	stdin  io.WriteCloser // write end -> PTY input
	stdout io.ReadCloser  // read end  <- PTY output
	cancel context.CancelFunc
	mu     sync.Mutex

	// Tier-specific fields (added for tiered spawn).
	tier      string // "wsl", "gitbash", "conpty", or "pipes"
	wslDistro string // WSL distro name (only set for WSL tier)
	linuxPID  int    // Linux-side PID for WSL kill (0 if capture failed)
	sessionID string // For temp file cleanup in WSL tier
}
```

- [ ] **Step 2: Verify build compiles**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./...`
Expected: PASS (new fields are zero-valued by default, so existing code is unaffected)

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/pty_windows.go
git commit -m "feat(session): add tier fields to ptyHandle struct"
```

---

### Task 5: Refactor `stop()` to use `force` parameter and tier dispatch

**Files:**

- Modify: `agent/internal/session/pty_windows.go:1058-1068`

- [ ] **Step 1: Write a test for force stop behavior**

Add to `agent/internal/session/manager_local_test.go`:

```go
func TestStopForce_KillsProcess(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	done := make(chan struct{})
	exitFn := func(sid string, code int, err error) {
		close(done)
	}
	outputFn := func(sid, data string) {}

	// Spawn a long-running process (ping -n 60 localhost) so we can kill it.
	sid := "test-stop-force"
	h, _, err := spawnWithPipes(ctx, sid,
		`C:\Windows\System32\cmd.exe`, []string{"/C", "ping", "-n", "60", "localhost"},
		".", nil, outputFn, nil, exitFn)
	if err != nil {
		t.Fatalf("spawnWithPipes: %v", err)
	}
	h.tier = "pipes" // set tier for dispatch

	// Force-stop should kill immediately.
	if err := h.stop(true); err != nil {
		t.Fatalf("stop(force=true): %v", err)
	}

	select {
	case <-done:
		// Process exited — success.
	case <-ctx.Done():
		t.Fatal("timed out waiting for process to exit after force stop")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -run TestStopForce -v -count=1`
Expected: PASS or FAIL (depends on whether `stop(_ bool)` happens to kill — either way the refactoring is needed)

- [ ] **Step 3: Refactor `stop()` method**

Replace the existing `stop` method (lines 1058-1068 of `pty_windows.go`):

```go
// stop terminates the child process. Behavior depends on tier and force flag.
//
// Graceful (force=false): send Ctrl+C to stdin pipe (all tiers except WSL).
// WSL graceful: send kill -TERM to the Linux PID via wsl.exe.
//
// Force (force=true): call proc.Kill() (all tiers). WSL also kills the Linux PID.
func (h *ptyHandle) stop(force bool) error {
	switch h.tier {
	case "wsl":
		return h.stopWSL(force)
	default:
		// ConPTY, Git Bash, pipes — all use the same mechanism.
		if force {
			return h.forceKill()
		}
		return h.gracefulStop()
	}
}

// gracefulStop sends Ctrl+C (\x03) to the stdin pipe.
func (h *ptyHandle) gracefulStop() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stdin != nil {
		_, err := h.stdin.Write([]byte{0x03}) // Ctrl+C
		return err
	}
	return nil
}

// forceKill terminates the Windows-side process immediately.
func (h *ptyHandle) forceKill() error {
	if h.proc != nil {
		return h.proc.Kill()
	}
	if h.cmd != nil && h.cmd.Process != nil {
		return h.cmd.Process.Kill()
	}
	h.cancel()
	return nil
}

// stopWSL handles WSL-specific stop behavior.
// Graceful: send kill -TERM to the Linux PID.
// Force: send kill -9, then kill the host-side wsl.exe.
func (h *ptyHandle) stopWSL(force bool) error {
	if h.linuxPID > 0 && h.wslDistro != "" {
		sig := "-TERM"
		if force {
			sig = "-9"
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "wsl", "-d", h.wslDistro, "--", "kill", sig, fmt.Sprintf("%d", h.linuxPID)).Run()
	}

	if force {
		return h.forceKill()
	}

	// Graceful fallback if no Linux PID: send Ctrl+C to stdin.
	if h.linuxPID == 0 {
		return h.gracefulStop()
	}
	return nil
}
```

Note: This adds `import "fmt"` which is already imported. Also requires adding `"time"` import if not already present (it is).

- [ ] **Step 4: Run tests to verify everything passes**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -run "TestStopForce|TestLocalOutputFn|TestStartWithLocalOutput" -v -count=1`
Expected: PASS (all existing tests + new test pass)

- [ ] **Step 5: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/pty_windows.go internal/session/manager_local_test.go
git commit -m "feat(session): refactor stop() for tier-aware dispatch with force param"
```

---

### Task 6: Refactor `close()` and `resize()` for tier dispatch

**Files:**

- Modify: `agent/internal/session/pty_windows.go:1048-1056` (resize) and `1080-1086` (close)

- [ ] **Step 1: Update `resize()` with debug logging**

Replace the existing `resize` method:

```go
// resize updates the ConPTY window dimensions.
// Only the ConPTY tier supports mid-session resize. WSL and Git Bash tiers
// set COLUMNS/LINES at spawn time; resize calls are logged and no-opped.
func (h *ptyHandle) resize(cols, rows uint16) error {
	if h.hPC == 0 {
		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Debug("resize no-op: no ConPTY handle",
				"tier", h.tier, "sessionId", h.sessionID,
				"cols", cols, "rows", rows,
			)
		}
		return nil
	}
	coord := windows.Coord{X: int16(cols), Y: int16(rows)}
	return windows.ResizePseudoConsole(h.hPC, coord)
}
```

- [ ] **Step 2: Update `close()` with tier-aware cleanup**

Replace the existing `close` method:

```go
// close cancels the context, releases stdin, and performs tier-specific cleanup.
func (h *ptyHandle) close() {
	h.cancel()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stdin != nil {
		h.stdin.Close()
	}

	// WSL-specific cleanup: remove the PID temp file and ensure wsl.exe is dead.
	if h.tier == "wsl" && h.wslDistro != "" && h.sessionID != "" {
		pidFile := fmt.Sprintf("/tmp/sf-%s.pid", h.sessionID)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "wsl", "-d", h.wslDistro, "--", "rm", "-f", pidFile).Run()
	}

	// Force-kill the host-side process to prevent orphaned wsl.exe / bash.exe.
	if h.proc != nil {
		_ = h.proc.Kill()
	}
}
```

- [ ] **Step 3: Verify build and tests pass**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./... && go test ./internal/session/ -v -count=1`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/pty_windows.go
git commit -m "feat(session): tier-aware close() and resize() with WSL cleanup"
```

---

### Task 7: Modify `spawnPTY()` to route by tier

**Files:**

- Modify: `agent/internal/session/pty_windows.go:499-538`

- [ ] **Step 1: Replace `spawnPTY()` body**

Replace the entire `spawnPTY` function (lines 499-538):

```go
// spawnPTY routes to the best available spawn backend based on the
// tier detected at startup. The function signature is unchanged from
// the original ConPTY-only implementation.
func spawnPTY(
	ctx context.Context,
	sessionID string,
	command string,
	workdir string,
	env map[string]string,
	outputFn func(sessionID, data string),
	localOutputFn func(raw []byte),
	exitFn func(sessionID string, exitCode int, err error),
) (*ptyHandle, int, error) {
	// Ensure tier detection has completed (no-op if WarmUpSpawnTier already ran).
	ensureTierDetected()

	if conPTYWorkingLogger != nil {
		conPTYWorkingLogger.Info("spawnPTY: routing session",
			"tier", spawnTier, "command", command, "sessionId", sessionID,
		)
	}

	switch spawnTier {
	case "wsl":
		// WSL tier: pass raw command string — shell handles PATH resolution.
		return spawnWithWSL(ctx, sessionID, command, workdir, env, outputFn, localOutputFn, exitFn)

	case "gitbash":
		// Git Bash tier: pass raw command string — bash -l -c handles resolution.
		return spawnWithGitBash(ctx, sessionID, command, workdir, env, outputFn, localOutputFn, exitFn)

	default:
		// ConPTY or pipe tier: resolve command to Windows binary path first.
		binary, args, err := resolveCommand(command)
		if err != nil {
			return nil, 0, fmt.Errorf("resolve command: %w", err)
		}

		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Info("spawnPTY: resolved command",
				"binary", binary, "args", args, "sessionId", sessionID,
			)
		}

		if conPTYWorking {
			return spawnWithConPTY(ctx, sessionID, binary, args, workdir, env, outputFn, localOutputFn, exitFn)
		}
		return spawnWithPipes(ctx, sessionID, binary, args, workdir, env, outputFn, localOutputFn, exitFn)
	}
}
```

- [ ] **Step 2: Delete `WarmUpConPTY()` and `conPTYWorkingOnce`**

Remove the `conPTYWorkingOnce` declaration (line 369) and the `WarmUpConPTY()` function (lines 548-559).

Keep `conPTYWorking` (line 370) and `conPTYWorkingLogger` (line 371) — they are still used.

Also remove the `conPTYWorkingOnce.Do(...)` call that was inside the old `spawnPTY` (lines 519-528) — that logic now lives in `runTierDetection()`.

- [ ] **Step 3: Verify build compiles**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./...`
Expected: FAIL — `spawnWithWSL` and `spawnWithGitBash` are not yet defined. That's expected — we'll add stub functions next.

- [ ] **Step 4: Add temporary stubs for `spawnWithWSL` and `spawnWithGitBash`**

Create temporary stub file `agent/internal/session/spawn_stubs_windows.go`:

```go
//go:build windows

package session

import (
	"context"
	"fmt"
)

// Temporary stubs — replaced by real implementations in Tasks 8 and 9.

func spawnWithWSL(
	ctx context.Context, sessionID, command, workdir string,
	env map[string]string,
	outputFn func(string, string), localOutputFn func([]byte),
	exitFn func(string, int, error),
) (*ptyHandle, int, error) {
	return nil, 0, fmt.Errorf("spawnWithWSL not yet implemented")
}

func spawnWithGitBash(
	ctx context.Context, sessionID, command, workdir string,
	env map[string]string,
	outputFn func(string, string), localOutputFn func([]byte),
	exitFn func(string, int, error),
) (*ptyHandle, int, error) {
	return nil, 0, fmt.Errorf("spawnWithGitBash not yet implemented")
}
```

- [ ] **Step 5: Verify full build + existing tests pass**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./... && go test ./internal/session/ -run "TestLocalOutputFn|TestStartWithLocalOutput" -v -count=1`
Expected: PASS (existing tests still work because they call `spawnWithPipes` directly, not `spawnPTY`)

- [ ] **Step 6: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/pty_windows.go internal/session/spawn_stubs_windows.go
git commit -m "feat(session): route spawnPTY() by detected tier, delete WarmUpConPTY"
```

---

### Task 8: Update `root.go` to call `WarmUpSpawnTier`

**Files:**

- Modify: `agent/internal/cli/root.go:144`

- [ ] **Step 1: Replace WarmUpConPTY call**

In `root.go` line 144, change:

```go
go session.WarmUpConPTY()
```

to:

```go
go session.WarmUpSpawnTier()
```

- [ ] **Step 2: Verify build compiles**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./...`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/cli/root.go
git commit -m "feat(cli): replace WarmUpConPTY with WarmUpSpawnTier in daemon init"
```

---

## Chunk 3: Git Bash Spawn Implementation

### Task 9: Implement `spawnWithGitBash()`

**Files:**

- Create: `agent/internal/session/spawn_gitbash_windows.go`
- Create: `agent/internal/session/spawn_gitbash_windows_test.go`
- Delete: stub in `spawn_stubs_windows.go` (remove `spawnWithGitBash`)

- [ ] **Step 1: Write the integration test**

Create `agent/internal/session/spawn_gitbash_windows_test.go`:

```go
//go:build windows

package session

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"
)

func TestSpawnWithGitBash_EchoOutput(t *testing.T) {
	bashPath := gitBashPath()
	if _, err := os.Stat(bashPath); err != nil {
		t.Skipf("Git Bash not available at %s — skipping", bashPath)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var outputMu sync.Mutex
	var outputChunks []string
	outputFn := func(sid, data string) {
		outputMu.Lock()
		outputChunks = append(outputChunks, data)
		outputMu.Unlock()
	}

	done := make(chan int, 1)
	exitFn := func(sid string, code int, err error) {
		done <- code
	}

	h, pid, err := spawnWithGitBash(ctx, "test-gitbash-echo", "echo hello-from-gitbash", ".", nil, outputFn, nil, exitFn)
	if err != nil {
		t.Fatalf("spawnWithGitBash: %v", err)
	}
	if pid == 0 {
		t.Fatal("expected non-zero PID")
	}

	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("expected exit code 0, got %d", code)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for process exit")
	}

	// Allow flush.
	time.Sleep(100 * time.Millisecond)

	outputMu.Lock()
	chunks := outputChunks
	outputMu.Unlock()

	if len(chunks) == 0 {
		t.Fatal("expected output chunks from echo command")
	}

	_ = h // ensure handle is valid
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -run TestSpawnWithGitBash_EchoOutput -v -count=1`
Expected: FAIL (stub returns "not yet implemented") or SKIP (if no Git Bash)

- [ ] **Step 3: Write `spawn_gitbash_windows.go`**

```go
// agent/internal/session/spawn_gitbash_windows.go
//go:build windows

package session

import (
	"context"
	"fmt"
	"os"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// spawnWithGitBash spawns a command inside the bundled Git Bash environment.
// bash.exe is a Windows executable — it can be spawned with CreateProcess
// using the same pipe infrastructure as spawnWithPipes. No ConPTY needed.
//
// command is the raw command string (e.g. "claude --profile work").
// bash -l -c handles word splitting and PATH resolution natively.
func spawnWithGitBash(
	ctx context.Context,
	sessionID string,
	command string,
	workdir string,
	env map[string]string,
	outputFn func(string, string),
	localOutputFn func([]byte),
	exitFn func(string, int, error),
) (*ptyHandle, int, error) {
	bashPath := detectedGitBashPath
	if bashPath == "" {
		bashPath = gitBashPath()
	}
	if _, err := os.Stat(bashPath); err != nil {
		return nil, 0, fmt.Errorf("Git Bash not found at %s: %w", bashPath, err)
	}

	// Build the command line: bash.exe -l -c "<command>"
	// Using -l (login shell) so /etc/profile is sourced and PATH is set up.
	//
	// If the script command is available, wrap with it for TTY forcing:
	//   bash -l -c "script -qfc '<command>' /dev/null"
	// Otherwise: bash -l -c "<command>"
	shellCmd := command
	// TODO: Validate if MinGit includes `script`. For now, use env-var forcing only.
	// Uncomment below if script is available in MinGit:
	// shellCmd = fmt.Sprintf("script -qfc '%s' /dev/null", strings.ReplaceAll(command, "'", "'\\''"))

	binary := bashPath
	args := []string{"-l", "-c", shellCmd}

	// --- Build env overlay with TTY-forcing vars ---
	mergedEnv := make(map[string]string)
	for k, v := range env {
		mergedEnv[k] = v
	}
	mergedEnv["FORCE_COLOR"] = "1"
	mergedEnv["TERM"] = "xterm-256color"
	// Set HOME to the Windows user profile so Git Bash translates it.
	if up := os.Getenv("USERPROFILE"); up != "" {
		mergedEnv["HOME"] = up
	}

	// --- Create inheritable pipes (same pattern as spawnWithPipes) ---
	_, cancel := context.WithCancel(ctx)

	sa := windows.SecurityAttributes{InheritHandle: 1}
	sa.Length = uint32(unsafe.Sizeof(sa))

	var stdinR, stdinW windows.Handle
	if err := windows.CreatePipe(&stdinR, &stdinW, &sa, 0); err != nil {
		cancel()
		return nil, 0, fmt.Errorf("create stdin pipe: %w", err)
	}
	if err := windows.SetHandleInformation(stdinW, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		cancel()
		return nil, 0, fmt.Errorf("set stdin write non-inheritable: %w", err)
	}

	var outR, outW windows.Handle
	if err := windows.CreatePipe(&outR, &outW, &sa, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		cancel()
		return nil, 0, fmt.Errorf("create output pipe: %w", err)
	}
	if err := windows.SetHandleInformation(outR, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		windows.CloseHandle(outR)
		windows.CloseHandle(outW)
		cancel()
		return nil, 0, fmt.Errorf("set output read non-inheritable: %w", err)
	}

	// --- STARTUPINFO with pipe handles ---
	const startfUsestdhandles uint32 = 0x00000100
	si := windows.StartupInfo{
		Flags:     startfUsestdhandles,
		StdInput:  stdinR,
		StdOutput: outW,
		StdErr:    outW,
	}
	si.Cb = uint32(unsafe.Sizeof(si))

	// --- Command line string ---
	cmdLine := windows.EscapeArg(binary)
	for _, a := range args {
		cmdLine += " " + windows.EscapeArg(a)
	}
	cmdLinePtr, _ := windows.UTF16PtrFromString(cmdLine)

	// --- Working directory ---
	var workdirPtr *uint16
	if workdir != "" && workdir != "." {
		workdirPtr, _ = windows.UTF16PtrFromString(workdir)
	}

	// --- Environment block ---
	envBlock := buildEnvBlock(mergedEnv)

	// --- CreateProcess flags ---
	const createNoWindow uint32 = 0x08000000
	const detachedProcess uint32 = 0x00000008
	creationFlags := createNoWindow | detachedProcess | createUnicodeEnvironment

	var procInfo windows.ProcessInformation
	if err := windows.CreateProcess(
		nil, cmdLinePtr,
		nil, nil,
		true,
		creationFlags,
		envBlock,
		workdirPtr,
		&si,
		&procInfo,
	); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		windows.CloseHandle(outR)
		windows.CloseHandle(outW)
		cancel()
		return nil, 0, fmt.Errorf("CreateProcess (gitbash): %w", err)
	}

	// Close child-side handles in parent.
	windows.CloseHandle(stdinR)
	windows.CloseHandle(outW)
	windows.CloseHandle(procInfo.Thread)

	stdinWriter := &pipeWriter{h: stdinW}
	outReader := &pipeReader{h: outR}

	proc, err := os.FindProcess(int(procInfo.ProcessId))
	if err != nil {
		windows.CloseHandle(stdinW)
		windows.CloseHandle(outR)
		windows.CloseHandle(procInfo.Process)
		cancel()
		return nil, 0, fmt.Errorf("FindProcess: %w", err)
	}

	h := &ptyHandle{
		proc:      proc,
		stdin:     stdinWriter,
		stdout:    outReader,
		cancel:    cancel,
		tier:      "gitbash",
		sessionID: sessionID,
	}

	if conPTYWorkingLogger != nil {
		conPTYWorkingLogger.Info("spawnWithGitBash: process created",
			"pid", procInfo.ProcessId, "sessionId", sessionID, "command", command,
		)
	}

	// Start output reader.
	go readPipeOutput(sessionID, outReader, outputFn, localOutputFn, nil)

	// Wait goroutine.
	go func() {
		defer cancel()
		state, waitErr := proc.Wait()
		stdinWriter.Close()
		outReader.Close()
		windows.CloseHandle(procInfo.Process)

		if waitErr != nil {
			exitFn(sessionID, -1, waitErr)
			return
		}
		code := 0
		if state != nil && !state.Success() {
			code = state.ExitCode()
		}
		exitFn(sessionID, code, nil)
	}()

	return h, int(procInfo.ProcessId), nil
}
```

- [ ] **Step 4: Remove `spawnWithGitBash` stub from `spawn_stubs_windows.go`**

Edit `spawn_stubs_windows.go` to only contain the WSL stub.

- [ ] **Step 5: Run test**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -run TestSpawnWithGitBash -v -count=1`
Expected: PASS (if Git Bash is bundled) or SKIP (if not available)

- [ ] **Step 6: Verify full build + all existing tests pass**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./... && go test ./internal/session/ -v -count=1`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/spawn_gitbash_windows.go internal/session/spawn_gitbash_windows_test.go internal/session/spawn_stubs_windows.go
git commit -m "feat(session): implement spawnWithGitBash using pipe infrastructure"
```

---

## Chunk 4: WSL Spawn Implementation

### Task 10: Implement `spawnWithWSL()`

**Files:**

- Create: `agent/internal/session/spawn_wsl_windows.go`
- Create: `agent/internal/session/spawn_wsl_windows_test.go`
- Delete: remaining stub in `spawn_stubs_windows.go`

- [ ] **Step 1: Write the integration test**

Create `agent/internal/session/spawn_wsl_windows_test.go`:

```go
//go:build windows

package session

import (
	"context"
	"os/exec"
	"sync"
	"testing"
	"time"
)

func TestSpawnWithWSL_EchoOutput(t *testing.T) {
	// Skip if WSL is not available.
	if err := exec.Command("wsl", "--status").Run(); err != nil {
		t.Skip("WSL not available — skipping")
	}
	distro, ok := detectWSL()
	if !ok {
		t.Skip("WSL available but no distro with claude — skipping")
	}
	// For this test, we just need WSL — we'll echo instead of running claude.
	// Temporarily set detectedWSLDistro for the spawn function.
	oldDistro := detectedWSLDistro
	detectedWSLDistro = distro
	defer func() { detectedWSLDistro = oldDistro }()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var outputMu sync.Mutex
	var outputChunks []string
	outputFn := func(sid, data string) {
		outputMu.Lock()
		outputChunks = append(outputChunks, data)
		outputMu.Unlock()
	}

	done := make(chan int, 1)
	exitFn := func(sid string, code int, err error) {
		done <- code
	}

	// Use "echo hello" instead of "claude" for testing without claude installed.
	h, pid, err := spawnWithWSL(ctx, "test-wsl-echo", "echo hello-from-wsl", ".", nil, outputFn, nil, exitFn)
	if err != nil {
		t.Fatalf("spawnWithWSL: %v", err)
	}
	if pid == 0 {
		t.Fatal("expected non-zero PID")
	}

	select {
	case code := <-done:
		t.Logf("WSL echo exited with code %d", code)
	case <-ctx.Done():
		t.Fatal("timed out waiting for process exit")
	}

	time.Sleep(100 * time.Millisecond)

	outputMu.Lock()
	chunks := outputChunks
	outputMu.Unlock()

	if len(chunks) == 0 {
		t.Fatal("expected output chunks from WSL echo")
	}

	_ = h
}
```

- [ ] **Step 2: Write `spawn_wsl_windows.go`**

```go
// agent/internal/session/spawn_wsl_windows.go
//go:build windows

package session

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// spawnWithWSL spawns a command inside a WSL distro via wsl.exe.
// wsl.exe is a Windows executable — spawned with CreateProcess + pipes.
//
// command is the raw command string (e.g. "claude --profile work").
// The WSL shell handles word splitting and PATH resolution natively.
func spawnWithWSL(
	ctx context.Context,
	sessionID string,
	command string,
	workdir string,
	env map[string]string,
	outputFn func(string, string),
	localOutputFn func([]byte),
	exitFn func(string, int, error),
) (*ptyHandle, int, error) {
	distro := detectedWSLDistro
	if distro == "" {
		return nil, 0, fmt.Errorf("WSL distro not detected")
	}

	wslBin, err := exec.LookPath("wsl.exe")
	if err != nil {
		return nil, 0, fmt.Errorf("wsl.exe not found: %w", err)
	}

	// Translate Windows workdir to WSL path.
	wslWorkdir := "/root"
	if workdir != "" && workdir != "." {
		if wp, ok := windowsToWSLPath(workdir); ok {
			wslWorkdir = wp
		}
	}

	// Build the shell command with PID sideband file.
	pidFile := fmt.Sprintf("/tmp/sf-%s.pid", sessionID)
	// "echo $$ > pidfile && exec <command>" — exec replaces shell with command,
	// so the PID we captured IS the command's PID.
	shellCmd := fmt.Sprintf("echo $$ > %s && cd %s && exec %s", pidFile, wslWorkdir, command)

	binary := wslBin
	args := []string{"-d", distro, "--", "sh", "-c", shellCmd}

	// --- Env overlay ---
	mergedEnv := make(map[string]string)
	for k, v := range env {
		mergedEnv[k] = v
	}
	mergedEnv["FORCE_COLOR"] = "1"
	mergedEnv["TERM"] = "xterm-256color"

	// --- Create pipes (same as spawnWithPipes / spawnWithGitBash) ---
	_, cancel := context.WithCancel(ctx)

	sa := windows.SecurityAttributes{InheritHandle: 1}
	sa.Length = uint32(unsafe.Sizeof(sa))

	var stdinR, stdinW windows.Handle
	if err := windows.CreatePipe(&stdinR, &stdinW, &sa, 0); err != nil {
		cancel()
		return nil, 0, fmt.Errorf("create stdin pipe: %w", err)
	}
	if err := windows.SetHandleInformation(stdinW, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		cancel()
		return nil, 0, fmt.Errorf("set stdin write non-inheritable: %w", err)
	}

	var outR, outW windows.Handle
	if err := windows.CreatePipe(&outR, &outW, &sa, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		cancel()
		return nil, 0, fmt.Errorf("create output pipe: %w", err)
	}
	if err := windows.SetHandleInformation(outR, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		windows.CloseHandle(outR)
		windows.CloseHandle(outW)
		cancel()
		return nil, 0, fmt.Errorf("set output read non-inheritable: %w", err)
	}

	// --- STARTUPINFO ---
	const startfUsestdhandles uint32 = 0x00000100
	si := windows.StartupInfo{
		Flags:     startfUsestdhandles,
		StdInput:  stdinR,
		StdOutput: outW,
		StdErr:    outW,
	}
	si.Cb = uint32(unsafe.Sizeof(si))

	// --- Command line ---
	cmdLine := windows.EscapeArg(binary)
	for _, a := range args {
		cmdLine += " " + windows.EscapeArg(a)
	}
	cmdLinePtr, _ := windows.UTF16PtrFromString(cmdLine)

	// --- Environment ---
	envBlock := buildEnvBlock(mergedEnv)

	// --- CreateProcess ---
	const createNoWindow uint32 = 0x08000000
	const detachedProcess uint32 = 0x00000008
	creationFlags := createNoWindow | detachedProcess | createUnicodeEnvironment

	var procInfo windows.ProcessInformation
	if err := windows.CreateProcess(
		nil, cmdLinePtr,
		nil, nil,
		true,
		creationFlags,
		envBlock,
		nil, // wsl.exe handles workdir via "cd" in shell command
		&si,
		&procInfo,
	); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		windows.CloseHandle(outR)
		windows.CloseHandle(outW)
		cancel()
		return nil, 0, fmt.Errorf("CreateProcess (wsl): %w", err)
	}

	windows.CloseHandle(stdinR)
	windows.CloseHandle(outW)
	windows.CloseHandle(procInfo.Thread)

	stdinWriter := &pipeWriter{h: stdinW}
	outReader := &pipeReader{h: outR}

	proc, err := os.FindProcess(int(procInfo.ProcessId))
	if err != nil {
		windows.CloseHandle(stdinW)
		windows.CloseHandle(outR)
		windows.CloseHandle(procInfo.Process)
		cancel()
		return nil, 0, fmt.Errorf("FindProcess: %w", err)
	}

	h := &ptyHandle{
		proc:      proc,
		stdin:     stdinWriter,
		stdout:    outReader,
		cancel:    cancel,
		tier:      "wsl",
		wslDistro: distro,
		sessionID: sessionID,
	}

	// --- Capture Linux PID via sideband file (async) ---
	go func() {
		linuxPID := captureWSLPID(distro, sessionID)
		h.mu.Lock()
		h.linuxPID = linuxPID
		h.mu.Unlock()
		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Info("WSL PID captured",
				"sessionId", sessionID, "linuxPID", linuxPID,
			)
		}
	}()

	if conPTYWorkingLogger != nil {
		conPTYWorkingLogger.Info("spawnWithWSL: process created",
			"pid", procInfo.ProcessId, "sessionId", sessionID,
			"distro", distro, "command", command,
		)
	}

	// Start output reader.
	go readPipeOutput(sessionID, outReader, outputFn, localOutputFn, nil)

	// Wait goroutine.
	go func() {
		defer cancel()
		state, waitErr := proc.Wait()
		stdinWriter.Close()
		outReader.Close()
		windows.CloseHandle(procInfo.Process)

		if waitErr != nil {
			exitFn(sessionID, -1, waitErr)
			return
		}
		code := 0
		if state != nil && !state.Success() {
			code = state.ExitCode()
		}
		exitFn(sessionID, code, nil)
	}()

	return h, int(procInfo.ProcessId), nil
}

// captureWSLPID reads the Linux PID from the sideband temp file.
// Polls for up to 3 seconds using a short-lived WSL command.
func captureWSLPID(distro, sessionID string) int {
	pidFile := fmt.Sprintf("/tmp/sf-%s.pid", sessionID)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Poll loop inside WSL: check every 0.5s for up to 3s.
	pollCmd := fmt.Sprintf(
		"for i in 1 2 3 4 5 6; do [ -f %s ] && cat %s && exit 0; sleep 0.5; done; exit 1",
		pidFile, pidFile,
	)

	out, err := exec.CommandContext(ctx, "wsl", "-d", distro, "--", "sh", "-c", pollCmd).CombinedOutput()
	if err != nil {
		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Warn("WSL PID capture failed",
				"sessionId", sessionID, "err", err,
			)
		}
		return 0
	}

	pidStr := strings.TrimSpace(string(out))
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Warn("WSL PID parse failed",
				"sessionId", sessionID, "raw", pidStr, "err", err,
			)
		}
		return 0
	}

	return pid
}
```

- [ ] **Step 3: Delete `spawn_stubs_windows.go`**

Remove the file entirely now that both real implementations exist.

- [ ] **Step 4: Verify full build**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./...`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -v -count=1`
Expected: PASS (WSL test may skip if no WSL, Git Bash test may skip if no bash.exe)

- [ ] **Step 6: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/spawn_wsl_windows.go internal/session/spawn_wsl_windows_test.go
git rm internal/session/spawn_stubs_windows.go 2>/dev/null; true
git commit -m "feat(session): implement spawnWithWSL with PID sideband capture"
```

---

## Chunk 5: Service Install & CI Bundling

### Task 11: Add Git Bash extraction to `service_windows.go`

**Files:**

- Modify: `agent/internal/cli/service_windows.go:86-181`

- [ ] **Step 1: Add Git Bash extraction + Claude install to `runServiceInstall`**

After the existing pre-flight checks (around line 117) and before the SCM section (line 152), add:

```go
	// ── Git Bash: Extract bundled MinGit and install Claude Code ────────────
	gitBashBin := filepath.Join(filepath.Dir(execPath), "gitbash", "bin", "bash.exe")
	if _, err := os.Stat(gitBashBin); err == nil {
		fmt.Printf("Found bundled Git Bash: %s\n", gitBashBin)

		// Try to install Claude Code via Git Bash (using the user's node/npm).
		fmt.Println("Installing Claude Code via Git Bash...")
		installCtx, installCancel := context.WithTimeout(context.Background(), 60*time.Second)
		installCmd := exec.CommandContext(installCtx, gitBashBin, "-l", "-c", "npm install -g @anthropic-ai/claude-code")
		installOut, installErr := installCmd.CombinedOutput()
		installCancel()

		if installErr != nil {
			fmt.Printf("WARNING: Claude Code install via Git Bash failed: %v\n", installErr)
			fmt.Printf("  Output: %s\n", string(installOut))
			fmt.Println("  The agent will attempt to install at startup.")
		} else {
			fmt.Println("Claude Code installed successfully via Git Bash.")
			cfg.ClaudeInstalledVia = "gitbash"
		}
	} else {
		fmt.Println("Note: Bundled Git Bash not found — will use system Claude CLI.")
	}
```

Also add the required imports at the top of the file: `"context"` and `"time"` (check if already present).

- [ ] **Step 2: Add `ClaudeInstalledVia` to config struct (informational only)**

In `agent/internal/config/config.go`, add to the `Config` struct:

```go
	// ClaudeInstalledVia records how Claude Code was installed (informational).
	// Values: "gitbash", "" (not set). Not used for tier selection — auto-detect only.
	ClaudeInstalledVia string `toml:"claude_installed_via,omitempty"`
```

- [ ] **Step 3: Verify build compiles**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./...`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/cli/service_windows.go internal/config/config.go
git commit -m "feat(install): add Git Bash Claude Code install during service install"
```

---

### Task 12: Update CI workflow to bundle MinGit

**Files:**

- Modify: `.github/workflows/release-agent.yml`

- [ ] **Step 1: Add MinGit download step to `build-latest` job**

After the "Build Windows agent" step (around line 73), add:

```yaml
- name: Download MinGit portable
  run: |
    MINGIT_VERSION="2.47.1"
    MINGIT_URL="https://github.com/git-for-windows/git/releases/download/v${MINGIT_VERSION}.windows.1/MinGit-${MINGIT_VERSION}-64-bit.zip"
    echo "Downloading MinGit ${MINGIT_VERSION}..."
    curl -L -o /tmp/mingit.zip "${MINGIT_URL}"
    mkdir -p agent/gitbash
    cd agent/gitbash
    unzip -q /tmp/mingit.zip
    rm /tmp/mingit.zip
    echo "MinGit extracted to agent/gitbash/"
    ls -la bin/bash.exe || echo "WARNING: bash.exe not found"
```

- [ ] **Step 2: Update the release files section to create a zip**

Replace the `files:` line in the "Create latest release" step:

````yaml
- name: Package Windows release
  run: |
    cd agent
    zip -r sessionforge-windows-amd64.zip sessionforge.exe gitbash/

- name: Create "latest" release with stable download URL
  uses: softprops/action-gh-release@v2
  with:
    tag_name: latest
    name: 'SessionForge Agent (latest)'
    body: |
      Rolling release built from master — commit ${{ github.sha }}.

      For pinned versions, see versioned releases (e.g. v1.0.0).

      **Windows one-liner:**
      ```powershell
      irm https://sessionforge.dev/install.ps1 | iex
      ```
    prerelease: true
    files: |
      agent/sessionforge-windows-amd64.zip
      agent/sessionforge.exe
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
````

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Jakeb\sessionforge
git add .github/workflows/release-agent.yml
git commit -m "ci: bundle MinGit portable in Windows release zip"
```

---

### Task 13: Update `install.ps1` to extract `gitbash/`

**Files:**

- Modify: `agent/scripts/install.ps1`

- [ ] **Step 1: Update download URL to use the zip archive**

The install script already downloads a zip and extracts it (lines 43-79). The zip now contains both `sessionforge.exe` and `gitbash/`. The existing `Expand-Archive` call handles this automatically since it extracts to `$INSTALL_DIR`.

However, we need to update the `$ARCHIVE` variable and download URL for the new zip name. Replace lines 43-44:

```powershell
$ARCHIVE      = "sessionforge-windows-amd64.zip"
$DOWNLOAD_URL = "https://github.com/$REPO/releases/download/$VERSION/$ARCHIVE"
```

Also add a verification step after extraction (after line 83):

```powershell
# Verify Git Bash was extracted.
$GitBash = "$INSTALL_DIR\gitbash\bin\bash.exe"
if (Test-Path $GitBash) {
    Write-Ok "Git Bash extracted: $GitBash"
} else {
    Write-Host "[sessionforge] Note: Git Bash not found in archive — will use system fallback." -ForegroundColor Yellow
}
```

- [ ] **Step 2: Commit**

```bash
cd C:\Users\Jakeb\sessionforge
git add agent/scripts/install.ps1
git commit -m "feat(install): verify Git Bash extraction in install script"
```

---

## Chunk 6: Validation & Integration Testing

### Task 14: End-to-end integration test

**Files:**

- Modify: `agent/internal/session/manager_local_test.go`

- [ ] **Step 1: Write E2E test that exercises tier routing**

Add to `manager_local_test.go`:

```go
func TestSpawnPTY_TierRouting(t *testing.T) {
	// Force tier detection to run.
	ensureTierDetected()
	t.Logf("Detected spawn tier: %s", spawnTier)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	done := make(chan struct{})
	var capturedCode int
	exitFn := func(sid string, code int, err error) {
		capturedCode = code
		close(done)
	}

	var outputMu sync.Mutex
	var outputChunks []string
	outputFn := func(sid, data string) {
		outputMu.Lock()
		outputChunks = append(outputChunks, data)
		outputMu.Unlock()
	}

	// Use "echo tier-test" which works across all tiers.
	h, pid, err := spawnPTY(ctx, "test-tier-routing", "echo tier-test", ".", nil, outputFn, nil, exitFn)
	if err != nil {
		t.Fatalf("spawnPTY: %v", err)
	}
	if pid == 0 {
		t.Fatal("expected non-zero PID")
	}
	t.Logf("Spawned via tier=%s, pid=%d", h.tier, pid)

	select {
	case <-done:
		t.Logf("Process exited with code %d", capturedCode)
	case <-ctx.Done():
		t.Fatal("timed out waiting for echo to finish")
	}

	time.Sleep(100 * time.Millisecond)

	outputMu.Lock()
	chunks := outputChunks
	outputMu.Unlock()

	if len(chunks) == 0 {
		t.Fatal("expected output from echo command")
	}
}
```

- [ ] **Step 2: Run the test**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./internal/session/ -run TestSpawnPTY_TierRouting -v -count=1`
Expected: PASS — routes to the detected tier and produces output

- [ ] **Step 3: Run ALL tests to verify no regressions**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./... -v -count=1`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/manager_local_test.go
git commit -m "test(session): add end-to-end tier routing integration test"
```

---

### Task 15: Set `tier` field in existing spawn functions

**Files:**

- Modify: `agent/internal/session/pty_windows.go`

- [ ] **Step 1: Add tier field to `spawnWithConPTY` return**

In `spawnWithConPTY`, where the `ptyHandle` is constructed (~line 728-734), add the `tier` field:

```go
	h := &ptyHandle{
		hPC:       hPC,
		proc:      proc,
		stdin:     stdinPW,
		stdout:    stdoutPR,
		cancel:    cancel,
		tier:      "conpty",
		sessionID: sessionID,
	}
```

- [ ] **Step 2: Add tier field to `spawnWithPipes` return**

In `spawnWithPipes`, where the `ptyHandle` is constructed (~line 941-945), add:

```go
	h := &ptyHandle{
		stdin:     stdinWriter,
		stdout:    outReader,
		cancel:    cancel,
		tier:      "pipes",
		sessionID: sessionID,
	}
```

- [ ] **Step 3: Verify build + tests**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go build ./... && go test ./internal/session/ -v -count=1`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add internal/session/pty_windows.go
git commit -m "feat(session): set tier field in ConPTY and pipes spawn functions"
```

---

### Task 16: Final cleanup and verification

- [ ] **Step 1: Verify no unused imports or dead code**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go vet ./...`
Expected: PASS (no warnings)

- [ ] **Step 2: Run all tests one final time**

Run: `cd C:\Users\Jakeb\sessionforge\agent && go test ./... -v -count=1`
Expected: PASS

- [ ] **Step 3: Verify Windows build**

Run: `cd C:\Users\Jakeb\sessionforge\agent && GOOS=windows GOARCH=amd64 go build -o /dev/null ./...`
Expected: PASS

- [ ] **Step 4: Verify Linux build (for Unix path unchanged)**

Run: `cd C:\Users\Jakeb\sessionforge\agent && GOOS=linux GOARCH=amd64 go build -o /dev/null ./...`
Expected: PASS

- [ ] **Step 5: Commit any final cleanup**

```bash
cd C:\Users\Jakeb\sessionforge\agent
git add -A
git commit -m "chore(session): final cleanup for tiered PTY spawn"
```

---

## Implementation Prerequisites (Validate Before Starting)

> From the spec, these must be checked before implementation begins:

1. **Git Bash PATH inheritance under LocalSystem** — During Task 11, after installing Claude via Git Bash in the service install flow, verify that `bash -l` correctly finds `node`/`npm`. If it doesn't, add a fallback that writes absolute paths to a `/etc/profile.d/` snippet.

2. **MinGit `script` command availability** — During Task 9, check if `usr/bin/script` exists in the MinGit distribution. If not, the `script -qfc` wrapping is omitted (the TODO comment in the code marks this).

3. **MinGit version and architecture** — During Task 12, pin the MinGit version in CI. Use the 64-bit build matching `windows-amd64`.

---

## Summary of All Files Touched

| File                                                   | Action | Task           |
| ------------------------------------------------------ | ------ | -------------- |
| `agent/internal/session/tier_stub.go`                  | Create | 1              |
| `agent/internal/session/tier_windows.go`               | Create | 2              |
| `agent/internal/session/tier_windows_test.go`          | Create | 2, 3           |
| `agent/internal/session/pty_windows.go`                | Modify | 4, 5, 6, 7, 15 |
| `agent/internal/session/spawn_gitbash_windows.go`      | Create | 9              |
| `agent/internal/session/spawn_gitbash_windows_test.go` | Create | 9              |
| `agent/internal/session/spawn_wsl_windows.go`          | Create | 10             |
| `agent/internal/session/spawn_wsl_windows_test.go`     | Create | 10             |
| `agent/internal/session/manager_local_test.go`         | Modify | 5, 14          |
| `agent/internal/cli/root.go`                           | Modify | 8              |
| `agent/internal/cli/service_windows.go`                | Modify | 11             |
| `agent/internal/config/config.go`                      | Modify | 11             |
| `.github/workflows/release-agent.yml`                  | Modify | 12             |
| `agent/scripts/install.ps1`                            | Modify | 13             |
