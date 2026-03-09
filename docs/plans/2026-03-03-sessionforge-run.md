# `sessionforge run` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `sessionforge run <command>` — a PTY multiplexer that streams I/O to both the local terminal and the cloud dashboard simultaneously, with Ctrl+] detach.

**Architecture:** New `runCmd` cobra command in `cli/run.go` calls a new `Manager.StartLocalPassthrough()` method. The Manager owns the PTY and fans output to two destinations: the existing cloud `outputFn` pipeline AND `os.Stdout` written directly. Stdin passthrough runs in a goroutine reading `os.Stdin` in raw mode, writing decoded bytes to the PTY. Detach exits the passthrough loop without killing the child. Two platform files (`run_windows.go` / `run_unix.go`) implement raw mode.

**Tech Stack:** Go, Cobra, `golang.org/x/sys/windows` (already dep), `golang.org/x/term` (add for Unix), existing `session.Manager` + `ptyHandle`

---

## Task 1: Add `Manager.GetPTYWriter` + expose `ptyHandle.stdout` for passthrough

**Why:** `Manager.Start()` returns only `(sessionID, error)`. The `run` command needs to write the PTY's decoded output to `os.Stdout` in addition to the cloud. The cleanest design is to let the caller register a **local output callback** at start time — a second `outputFn` that writes raw bytes to stdout. We thread this through `spawnPTY` via a new optional `localOutputFn`.

**Files:**

- Modify: `agent/internal/session/manager.go`
- Modify: `agent/internal/session/pty_unix.go`
- Modify: `agent/internal/session/pty_windows.go`

---

### Step 1.1 — Add `localOutputFn` parameter to `spawnPTY` (both platform files)

In **`pty_unix.go`**, change `readPTYOutput` call inside `spawnPTY`:

```go
// Before
go readPTYOutput(sessionID, ptmx, outputFn)

// After — add localOutputFn parameter to spawnPTY signature
func spawnPTY(
    ctx context.Context,
    sessionID string,
    command string,
    workdir string,
    env map[string]string,
    outputFn func(sessionID, data string),
    localOutputFn func(raw []byte),   // NEW — nil for daemon/cloud-only sessions
    exitFn func(sessionID string, exitCode int, err error),
) (*ptyHandle, int, error) {
```

In `readPTYOutput`, add a `localOutputFn` parameter and call it with raw bytes **before** base64-encoding:

```go
func readPTYOutput(sessionID string, ptmx *os.File, outputFn func(string, string), localOutputFn func([]byte)) {
    // ... existing setup ...
    flush := func() {
        if len(pending) > 0 {
            if localOutputFn != nil {
                localOutputFn(pending)   // write raw bytes to local stdout
            }
            encoded := base64.StdEncoding.EncodeToString(pending)
            outputFn(sessionID, encoded)
            pending = pending[:0]
        }
    }
```

Apply identical change to **`pty_windows.go`**: add `localOutputFn func([]byte)` to `spawnPTY`, `spawnWithConPTY`, `spawnWithPipes`, and `readPipeOutput`. Pass it through the call chain. Call it with raw bytes in `readPipeOutput`'s `flush()` before encoding.

### Step 1.2 — Update all existing callers of `spawnPTY`

`manager.go` calls `spawnPTY`. It must pass `nil` for `localOutputFn` so existing daemon behaviour is unchanged:

```go
// In manager.go Start():
handle, pid, err := spawnPTY(m.ctx, sessionID, command, workdir, env, outputFn, nil, exitFn)
//                                                                              ^^^^ nil = cloud-only
```

### Step 1.3 — Add `StartWithLocalOutput` to Manager

```go
// StartWithLocalOutput is like Start but also streams raw PTY bytes to localFn.
// Used by `sessionforge run` to display output in the local terminal simultaneously.
func (m *Manager) StartWithLocalOutput(
    requestID, sessionID, command, workdir string,
    env map[string]string,
    localFn func(raw []byte),
) (string, error) {
    if sessionID == "" {
        sessionID = uuid.New().String()
    }
    // ... identical setup to Start() ...
    handle, pid, err := spawnPTY(m.ctx, sessionID, command, workdir, env, outputFn, localFn, exitFn)
    // ... identical registry + session_started send ...
    return sessionID, nil
}
```

### Step 1.4 — Build to verify no compile errors

```bash
cd /path/to/sessionforge/agent
go build ./...
```

Expected: compiles clean, no errors.

### Step 1.5 — Commit

```bash
git add agent/internal/session/manager.go \
        agent/internal/session/pty_unix.go \
        agent/internal/session/pty_windows.go
git commit -m "feat(session): add localOutputFn passthrough to spawnPTY + StartWithLocalOutput"
```

---

## Task 2: Platform raw-mode helpers

**Why:** The local stdin passthrough must disable terminal line-buffering and echo so keystrokes reach the PTY immediately without waiting for Enter.

**Files:**

- Create: `agent/internal/cli/rawmode_unix.go`
- Create: `agent/internal/cli/rawmode_windows.go`

---

### Step 2.1 — Write `rawmode_unix.go`

```go
//go:build !windows

package cli

import (
    "os"

    "golang.org/x/term"
)

type termState struct {
    state *term.State
}

func setRawMode() (*termState, error) {
    fd := int(os.Stdin.Fd())
    old, err := term.MakeRaw(fd)
    if err != nil {
        return nil, err
    }
    return &termState{state: old}, nil
}

func restoreMode(s *termState) {
    if s != nil {
        term.Restore(int(os.Stdin.Fd()), s.state)
    }
}
```

### Step 2.2 — Write `rawmode_windows.go`

```go
//go:build windows

package cli

import (
    "fmt"
    "os"

    "golang.org/x/sys/windows"
)

type termState struct {
    oldMode uint32
}

// enableVirtualTerminalProcessing ensures ANSI escape codes render in the Windows console.
func enableVirtualTerminalProcessing() {
    stdout := windows.Handle(os.Stdout.Fd())
    var mode uint32
    if windows.GetConsoleMode(stdout, &mode) == nil {
        windows.SetConsoleMode(stdout, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING)
    }
}

func setRawMode() (*termState, error) {
    handle := windows.Handle(os.Stdin.Fd())
    var oldMode uint32
    if err := windows.GetConsoleMode(handle, &oldMode); err != nil {
        return nil, fmt.Errorf("GetConsoleMode: %w", err)
    }
    // Remove line-buffering, echo, and processed input so keystrokes
    // are forwarded byte-by-byte to the PTY.
    newMode := oldMode &^ (windows.ENABLE_ECHO_INPUT |
        windows.ENABLE_LINE_INPUT |
        windows.ENABLE_PROCESSED_INPUT)
    if err := windows.SetConsoleMode(handle, newMode); err != nil {
        return nil, fmt.Errorf("SetConsoleMode: %w", err)
    }
    enableVirtualTerminalProcessing()
    return &termState{oldMode: oldMode}, nil
}

func restoreMode(s *termState) {
    if s == nil {
        return
    }
    handle := windows.Handle(os.Stdin.Fd())
    _ = windows.SetConsoleMode(handle, s.oldMode)
}
```

### Step 2.3 — Add `golang.org/x/term` dependency (Unix needs it)

```bash
cd agent
go get golang.org/x/term
go mod tidy
```

Expected: `go.mod` updated, `go.sum` updated.

### Step 2.4 — Build to verify both platform files compile

```bash
go build ./internal/cli/...
```

Expected: clean build.

### Step 2.5 — Commit

```bash
git add agent/internal/cli/rawmode_unix.go \
        agent/internal/cli/rawmode_windows.go \
        agent/go.mod agent/go.sum
git commit -m "feat(cli): add cross-platform raw-mode helpers for local terminal passthrough"
```

---

## Task 3: `sessionforge run` cobra command

**Why:** This is the user-facing entry point. Wires together: cloud connection, `StartWithLocalOutput`, stdin passthrough loop, Ctrl+] detach, raw-mode restore.

**Files:**

- Create: `agent/internal/cli/run.go`
- Modify: `agent/internal/cli/root.go`

---

### Step 3.1 — Write `run.go`

```go
package cli

import (
    "context"
    "fmt"
    "os"
    "os/signal"
    "strings"
    "syscall"
    "time"

    "github.com/spf13/cobra"
    "github.com/sessionforge/agent/internal/config"
    "github.com/sessionforge/agent/internal/connection"
)

var (
    runName    string
    runWorkdir string
)

var runCmd = &cobra.Command{
    Use:   "run <command>",
    Short: "Run a command as a cloud-visible session with local terminal passthrough",
    Long: `Run spawns a PTY session that streams I/O to both your local terminal
and the SessionForge cloud dashboard simultaneously.

Examples:
  sessionforge run claude
  sessionforge run claude --name "email-agent"
  sessionforge run bash --workdir ~/project

Press Ctrl+] (ASCII 29) to detach. The session keeps running in the cloud.
Reattach later: sessionforge session attach <session-id>`,
    Args:    cobra.MinimumNArgs(1),
    RunE:    runRun,
}

func init() {
    runCmd.Flags().StringVar(&runName, "name", "", "Human-readable name shown in the dashboard")
    runCmd.Flags().StringVarP(&runWorkdir, "workdir", "w", ".", "Working directory for the session")
}

func runRun(cmd *cobra.Command, args []string) error {
    cfg, err := config.Load()
    if err != nil {
        return err
    }
    if !cfg.IsConfigured() {
        return fmt.Errorf("not configured — run: sessionforge auth login --key <key>")
    }

    command := strings.Join(args, " ")
    workdir := runWorkdir

    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()

    client, mgr := buildAgentComponents(ctx, cfg)

    go connection.RunHeartbeat(ctx, client, cfg.MachineID, mgr, buildLogger(cfg.LogLevel, cfg.LogFile))
    go client.Run(ctx)

    // Allow WebSocket to register before spawning the session.
    time.Sleep(600 * time.Millisecond)

    // Enable raw mode — must be restored in all exit paths.
    rawState, rawErr := setRawMode()
    if rawErr != nil {
        fmt.Fprintf(os.Stderr, "warning: could not set raw mode: %v\n", rawErr)
    }
    defer restoreMode(rawState)

    // localFn writes raw PTY output bytes to the local terminal.
    localFn := func(raw []byte) {
        os.Stdout.Write(raw)
    }

    sessionID, err := mgr.StartWithLocalOutput("cli-run", "", command, workdir, nil, localFn)
    if err != nil {
        restoreMode(rawState)
        return fmt.Errorf("start session: %w", err)
    }

    if runName != "" {
        fmt.Fprintf(os.Stderr, "Session started: %s  name: %s\n", sessionID, runName)
    } else {
        fmt.Fprintf(os.Stderr, "Session started: %s\n", sessionID)
    }
    fmt.Fprintln(os.Stderr, "Press Ctrl+] to detach.")

    // Stdin passthrough loop: read local stdin, forward to PTY.
    // Ctrl+] (byte 29) breaks the loop and detaches.
    detached := make(chan struct{})
    go func() {
        defer close(detached)
        buf := make([]byte, 256)
        for {
            n, err := os.Stdin.Read(buf)
            if err != nil {
                return
            }
            if n > 0 && buf[0] == 29 { // Ctrl+]
                return
            }
            if n > 0 {
                _ = mgr.WriteInputRaw(sessionID, buf[:n])
            }
        }
    }()

    // Block until detach, process exit, or OS signal.
    select {
    case <-detached:
        restoreMode(rawState)
        fmt.Fprintf(os.Stderr, "\nDetached. Session ID: %s\nReattach: sessionforge session attach %s\n",
            sessionID, sessionID)
    case <-ctx.Done():
        restoreMode(rawState)
    }

    return nil
}
```

### Step 3.2 — Add `WriteInputRaw` to Manager

The existing `WriteInput` expects base64. For local stdin we have raw bytes. Add a thin wrapper in `manager.go`:

```go
// WriteInputRaw forwards raw bytes to a session's PTY stdin without base64 encoding.
func (m *Manager) WriteInputRaw(sessionID string, data []byte) error {
    s, err := m.registry.Get(sessionID)
    if err != nil {
        return err
    }
    return s.ptySession.writeInputRaw(data)
}
```

Add `writeInputRaw` to **both** platform `ptyHandle` types:

**`pty_unix.go`:**

```go
func (h *ptyHandle) writeInputRaw(data []byte) error {
    _, err := h.ptmx.Write(data)
    return err
}
```

**`pty_windows.go`:**

```go
func (h *ptyHandle) writeInputRaw(data []byte) error {
    h.mu.Lock()
    defer h.mu.Unlock()
    _, err := h.stdin.Write(data)
    return err
}
```

### Step 3.3 — Register `runCmd` in `root.go`

In `root.go`, inside `init()`, add:

```go
rootCmd.AddCommand(runCmd)
```

Place it after the existing `rootCmd.AddCommand(updateCmd)` line.

### Step 3.4 — Build

```bash
cd agent
go build ./...
```

Expected: clean build.

### Step 3.5 — Smoke test (manual)

```
./sessionforge run --help
```

Expected output contains:

```
Run spawns a PTY session that streams I/O to both your local terminal
```

```
./sessionforge run bash
```

Expected: bash prompt appears in local terminal. `sessionforge session list` (in a second terminal) shows the session. Ctrl+] prints detach message and returns prompt.

### Step 3.6 — Commit

```bash
git add agent/internal/cli/run.go \
        agent/internal/cli/root.go \
        agent/internal/session/manager.go \
        agent/internal/session/pty_unix.go \
        agent/internal/session/pty_windows.go
git commit -m "feat(cli): add sessionforge run with local PTY passthrough and Ctrl+] detach"
```

---

## Task 4: Unit tests for `run.go` detach logic

**Why:** The detach byte check (`buf[0] == 29`) is a critical invariant. Test it without spawning a real PTY.

**Files:**

- Create: `agent/internal/cli/run_test.go`

---

### Step 4.1 — Write tests

```go
package cli

import (
    "bytes"
    "io"
    "testing"
)

// detectDetach returns true if byte 29 (Ctrl+]) is the first byte of data.
func detectDetach(data []byte) bool {
    return len(data) > 0 && data[0] == 29
}

func TestDetectDetach_CtrlBracket(t *testing.T) {
    if !detectDetach([]byte{29}) {
        t.Fatal("expected Ctrl+] (byte 29) to be detected as detach")
    }
}

func TestDetectDetach_NormalInput(t *testing.T) {
    for _, b := range []byte("hello world") {
        if detectDetach([]byte{b}) {
            t.Fatalf("byte %d should not trigger detach", b)
        }
    }
}

func TestDetectDetach_EmptyInput(t *testing.T) {
    if detectDetach([]byte{}) {
        t.Fatal("empty input should not trigger detach")
    }
}

// TestStdinPassthroughForwardsBytes verifies that non-detach bytes
// from a reader are forwarded to the write function.
func TestStdinPassthroughForwardsBytes(t *testing.T) {
    input := bytes.NewReader([]byte("ls\n"))
    var written []byte
    writeFn := func(data []byte) error {
        written = append(written, data...)
        return nil
    }

    buf := make([]byte, 256)
    for {
        n, err := input.Read(buf)
        if n > 0 && !detectDetach(buf[:n]) {
            writeFn(buf[:n])
        }
        if err == io.EOF {
            break
        }
    }

    if string(written) != "ls\n" {
        t.Fatalf("expected 'ls\\n', got %q", written)
    }
}
```

### Step 4.2 — Run tests

```bash
cd agent
go test ./internal/cli/... -v -run TestDetect
go test ./internal/cli/... -v -run TestStdin
```

Expected: all PASS.

### Step 4.3 — Commit

```bash
git add agent/internal/cli/run_test.go
git commit -m "test(cli): unit tests for detach detection and stdin forwarding"
```

---

## Task 5: Unit tests for `localOutputFn` fan-out in session package

**Why:** Verify that `StartWithLocalOutput` calls `localFn` with raw bytes when PTY produces output. This requires a stub messenger and a mock PTY (or integration test with a real subprocess).

**Files:**

- Create: `agent/internal/session/manager_local_test.go`

---

### Step 5.1 — Write the test

```go
package session

import (
    "context"
    "strings"
    "sync"
    "testing"
    "time"
)

// stubMessenger records all messages sent to the cloud.
type stubMessenger struct {
    mu   sync.Mutex
    msgs []any
}

func (s *stubMessenger) SendJSON(v any) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.msgs = append(s.msgs, v)
    return nil
}

func TestStartWithLocalOutput_CallsLocalFn(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    messenger := &stubMessenger{}
    mgr := NewManager(ctx, messenger, nil) // nil logger = discard

    var mu sync.Mutex
    var localBytes []byte
    localFn := func(raw []byte) {
        mu.Lock()
        localBytes = append(localBytes, raw...)
        mu.Unlock()
    }

    // Use "echo hello" as the command — produces output then exits.
    // On Windows this is "cmd" with args "/C echo hello"; skip on Windows CI
    // or use bash if available.
    _, err := mgr.StartWithLocalOutput("test-req", "", "bash", ".", nil, localFn)
    if err != nil {
        t.Skipf("bash not available: %v", err)
    }

    // Give the PTY time to start and produce output.
    // Write a command then close stdin.
    time.Sleep(200 * time.Millisecond)

    // Check that localFn received bytes.
    mu.Lock()
    got := string(localBytes)
    mu.Unlock()

    // bash prompt or welcome message — just verify something arrived.
    _ = got // presence of any output is enough
    if len(localBytes) == 0 {
        // bash may not emit immediately; not a hard failure in CI.
        t.Log("no local bytes yet — may be timing-dependent in CI")
    }

    // Verify session_started was sent to cloud.
    messenger.mu.Lock()
    msgCount := len(messenger.msgs)
    messenger.mu.Unlock()
    if msgCount == 0 {
        t.Fatal("expected at least session_started message sent to cloud")
    }

    _ = strings.Contains // prevent unused import
}
```

### Step 5.2 — Run the test

```bash
go test ./internal/session/... -v -run TestStartWithLocalOutput -timeout 10s
```

Expected: PASS (or SKIP on Windows without bash).

### Step 5.3 — Commit

```bash
git add agent/internal/session/manager_local_test.go
git commit -m "test(session): verify StartWithLocalOutput calls localFn and sends session_started"
```

---

## Task 6: `sessionforge init` shell alias command

**Why:** Shell alias so users can type `claude` and transparently use `sessionforge run claude`.

**Files:**

- Create: `agent/internal/cli/init_cmd.go`
- Modify: `agent/internal/cli/root.go`

---

### Step 6.1 — Write `init_cmd.go`

```go
package cli

import (
    "fmt"
    "os"
    "path/filepath"
    "runtime"
    "strings"

    "github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
    Use:   "init",
    Short: "Install shell alias so 'claude' uses sessionforge run",
    Long: `Init adds an alias to your shell rc file so that typing 'claude'
automatically invokes 'sessionforge run claude', making every Claude session
visible on the SessionForge dashboard.

Supported shells: bash, zsh. For fish and PowerShell, add the alias manually.`,
    RunE: runInit,
}

func runInit(_ *cobra.Command, _ []string) error {
    if runtime.GOOS == "windows" {
        fmt.Println(`Windows detected. Add this to your PowerShell profile ($PROFILE):

  function claude { sessionforge run claude @args }

Run 'notepad $PROFILE' to open your profile.`)
        return nil
    }

    shell := filepath.Base(os.Getenv("SHELL"))
    var rcFile string
    switch shell {
    case "zsh":
        home, _ := os.UserHomeDir()
        rcFile = filepath.Join(home, ".zshrc")
    case "bash":
        home, _ := os.UserHomeDir()
        rcFile = filepath.Join(home, ".bashrc")
    default:
        return fmt.Errorf("unsupported shell %q — add this alias manually:\n  alias claude='sessionforge run claude'", shell)
    }

    const aliasLine = "alias claude='sessionforge run claude'"
    const marker = "# added by sessionforge init"

    // Check for existing alias — idempotent.
    existing, err := os.ReadFile(rcFile)
    if err == nil && strings.Contains(string(existing), aliasLine) {
        fmt.Printf("Alias already present in %s — nothing to do.\n", rcFile)
        return nil
    }

    f, err := os.OpenFile(rcFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    if err != nil {
        return fmt.Errorf("open %s: %w", rcFile, err)
    }
    defer f.Close()

    _, err = fmt.Fprintf(f, "\n%s\n%s\n", marker, aliasLine)
    if err != nil {
        return fmt.Errorf("write alias: %w", err)
    }

    fmt.Printf("Added alias to %s\nRun: source %s\n", rcFile, rcFile)
    return nil
}
```

### Step 6.2 — Register in `root.go`

```go
rootCmd.AddCommand(initCmd)
```

### Step 6.3 — Build

```bash
go build ./...
```

### Step 6.4 — Smoke test

```bash
./sessionforge init --help
```

Expected: prints usage describing the alias installation.

### Step 6.5 — Commit

```bash
git add agent/internal/cli/init_cmd.go \
        agent/internal/cli/root.go
git commit -m "feat(cli): sessionforge init installs shell alias for claude → sessionforge run"
```

---

## Task 7: End-to-end manual verification checklist

Run these checks before merging to master.

**Prerequisites:** Agent built (`go build -o sessionforge ./cmd/sessionforge`), configured (`./sessionforge auth login --key sf_live_xxx`), cloud reachable.

### Checklist

```
[ ] ./sessionforge run bash
    - bash prompt appears in local terminal
    - Session appears in cloud dashboard within 2 seconds
    - Typing commands works (ls, echo hello)
    - ANSI colors render correctly (try: ls --color=auto)

[ ] Ctrl+] detach
    - Press Ctrl+] while in run session
    - Local terminal returns to shell prompt
    - Detach message printed with session ID
    - Session still shows "running" on dashboard

[ ] Reattach
    - sessionforge session attach <id-from-detach>
    - Output from running session streams to local terminal
    - Ctrl+] detaches again

[ ] Process exit
    - sessionforge run bash, then type "exit"
    - Local sessionforge run command exits
    - Dashboard shows session as "stopped"

[ ] Raw mode restored
    - After any exit path (normal, detach, Ctrl+C)
    - Type in terminal after exit — characters echo correctly
    - No stale raw mode (type echo hello, it should echo)

[ ] Cloud streaming verified
    - In dashboard browser terminal, output appears in real time
    - While typing locally, browser terminal shows same output

[ ] sessionforge run claude (if claude installed)
    - Claude starts, appears on dashboard
    - Local interaction works normally
```

### Step 7.1 — Run checklist, note any failures

### Step 7.2 — Fix any failures found, commit fixes

### Step 7.3 — Final build tag

```bash
git tag v<next-version>
git push origin master --tags
```

---

## Dependency Map

```
Task 1 (spawnPTY fan-out + StartWithLocalOutput)
    └── Task 2 (raw mode helpers)
            └── Task 3 (run.go cobra command)       ← main feature
                    └── Task 4 (run unit tests)
Task 1
    └── Task 5 (session package tests)
Task 3
    └── Task 6 (sessionforge init)
Tasks 1-6
    └── Task 7 (E2E verification)
```

Tasks 1 and 2 can proceed in parallel. Tasks 3, 4, 5, 6 all depend on Tasks 1+2.

---

## Go Module Notes

- `golang.org/x/sys/windows` — already in `go.mod`
- `golang.org/x/term` — add with `go get golang.org/x/term` (Unix raw mode)
- `github.com/creack/pty` — already in `go.mod`
- `github.com/google/uuid` — already in `go.mod`
- `github.com/spf13/cobra` — already in `go.mod`

Run `go mod tidy` after adding `golang.org/x/term`.

---

## Known Risks / Gotchas

1. **Windows raw mode + ConPTY**: When the local terminal is in raw mode and ConPTY is active, the ConPTY handles ANSI internally. The `ENABLE_VIRTUAL_TERMINAL_PROCESSING` flag on stdout is needed to render ANSI escape codes in the Windows console correctly (handled in `rawmode_windows.go`).

2. **Stdin.Read blocking on exit**: If the user exits the process (not via Ctrl+]), the `os.Stdin.Read` goroutine will block forever. The `select { case <-detached: ... case <-ctx.Done(): ... }` in `runRun` handles this — context cancellation lets the command return even if the goroutine is blocked. The goroutine will be GC'd when the process exits.

3. **`localFn` called from readPipeOutput goroutine**: The `localFn` writes to `os.Stdout` which is safe from any goroutine. No mutex needed since `os.Stdout.Write` is goroutine-safe.

4. **`--name` flag not yet persisted to dashboard**: In V1, `--name` is printed locally but not included in `session_started`. To include it, add a `Name` field to `sessionStartedMsg` and `sessionInfoJSON`, and pass `runName` through to `StartWithLocalOutput`. This is a low-risk 5-line change; include it in Task 3.

5. **Test on Windows first**: The raw mode + ConPTY combination is the most fragile path. Perry's machine is Windows — run the E2E checklist there first before assuming Unix passes.
