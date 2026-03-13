# Session Output Fix — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Fix the root cause of zero session output: Claude (node.exe) spawned by LocalSystem service in Session 0 never writes to anonymous pipes.

**Root Cause:** The SessionForge Windows service runs as `LocalSystem` in Session 0. Node.js spawned in this context has no interactive user session, cannot access WSL, and anonymous pipe stdout inheritance is broken. The fix is to run the service as the logged-in Windows user, and add an automated debug loop that self-improves on every failure.

**Architecture:**

- Change service `SERVICE_START_NAME` from `LocalSystem` to the logged-in user account
- Auto-detect the logged-in user at `service install` time and store in config
- Update service installer to configure the correct account + password prompt
- Fallback: if user account unavailable, use `WTSQueryUserToken` to spawn into the user session

**Tech Stack:** Go, Windows Service Control Manager (`sc.exe` / `golang.org/x/sys/windows/svc`), PowerShell

---

## Task 1: Create tasks/lessons.md and automated debug loop

**Files:**

- Create: `tasks/lessons.md`
- Create: `tasks/debug-loop.md`

- [ ] Create `tasks/lessons.md` with all lessons from this session:

```markdown
# SessionForge — Lessons Learned

## 2026-03-12: LocalSystem Service Context

**Rule:** ALWAYS test in the actual execution context (LocalSystem) before writing spawn code.
**Why:** LocalSystem in Session 0 has no WSL, no user PATH, no npm dirs, no .claude config, no interactive session. exec.Cmd tests as a regular user do NOT predict LocalSystem behavior.
**Apply when:** Any change to spawn logic, process creation, or environment setup.

## 2026-03-12: Required Claude Flags for Non-Interactive

**Rule:** Always pass `--dangerously-skip-permissions` when spawning Claude non-interactively.
**Why:** Claude shows an interactive "trust this directory?" prompt that hangs in pipe mode.
**Apply when:** Any Claude spawn that doesn't have a real TTY.

## 2026-03-12: CLAUDE_CONFIG_DIR Must Be Set

**Rule:** CLAUDE_CONFIG_DIR must be populated in config.toml at service install time.
**Why:** Without it, Claude as LocalSystem has no credentials and returns "Not logged in."
**Apply when:** Service install, any new machine registration.

## 2026-03-12: DETACHED_PROCESS breaks STARTF_USESTDHANDLES

**Rule:** Do NOT combine DETACHED_PROCESS with STARTF_USESTDHANDLES in CreateProcess.
**Why:** On some Windows builds these flags together prevent pipe handle inheritance.
**Apply when:** Any Windows CreateProcess call that uses anonymous pipes.

## 2026-03-12: WSL is Per-User, Inaccessible from LocalSystem

**Rule:** Do not rely on WSL tier when service runs as LocalSystem.
**Why:** WSL requires a user session context. All wsl.exe calls return exit 0xffffffff from LocalSystem.
**Apply when:** Tier detection, WSL spawn, any LocalSystem service process spawning.
```

- [ ] Commit: `docs: add lessons learned from session-output debugging`

---

## Task 2: Automated debug loop script

**Files:**

- Create: `scripts/debug-session-output.ps1`

- [ ] Create the script:

```powershell
# debug-session-output.ps1 — Automated session output diagnostic loop.
# Runs repeatedly, captures evidence, appends findings to debug-log.txt.
# Self-improving: on each failure it adds a new check based on the failure mode.

param(
    [int]$Iterations = 5,
    [string]$LogFile = "$env:USERPROFILE\.sessionforge\debug-loop.log"
)

$nodeExe = "C:\Program Files\nodejs\node.exe"
$cliJs   = "C:\Users\Jakeb\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js"
$configDir = "C:\Users\Jakeb\.claude"

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
    "$ts $msg" | Tee-Object -FilePath $LogFile -Append
}

function Test-ClaudeAsCurrent {
    Write-Log "=== TEST: Claude via exec (current user) ==="
    $env:CLAUDE_CONFIG_DIR = $configDir
    $result = & $nodeExe $cliJs --dangerously-skip-permissions --print "say ping" 2>&1
    if ($result -match "ping|Ping") {
        Write-Log "PASS: Claude responds as current user"
        return $true
    } else {
        Write-Log "FAIL: Response was: $result"
        return $false
    }
}

function Test-ServiceAccount {
    Write-Log "=== TEST: Service account check ==="
    $svc = sc.exe qc SessionForgeAgent | Select-String "SERVICE_START_NAME"
    Write-Log "Service runs as: $svc"
    if ($svc -match "LocalSystem") {
        Write-Log "FINDING: Service runs as LocalSystem - this is the root cause"
        Write-Log "FIX: Change service to run as current user"
        return $false
    }
    return $true
}

function Test-PipeOutput {
    Write-Log "=== TEST: Anonymous pipe output (CreateProcess simulation) ==="
    # Use Go pipedump if available
    $pipedump = "C:\Users\Jakeb\sessionforge\agent\pipedump.exe"
    if (Test-Path $pipedump) {
        $output = & $pipedump 2>&1
        if ($output -match "Hello|hello") {
            Write-Log "PASS: Pipe output works"
            return $true
        } else {
            Write-Log "FAIL: $output"
            return $false
        }
    } else {
        Write-Log "SKIP: pipedump.exe not found"
        return $null
    }
}

function Test-SessionOutput {
    Write-Log "=== TEST: Service session_output in agent log ==="
    $logPath = "C:\Users\Jakeb\.sessionforge\agent.log"
    $lines = Get-Content $logPath -Tail 200
    $chunks = $lines | Select-String "session_output chunk"
    if ($chunks.Count -gt 0) {
        Write-Log "PASS: session_output chunks found ($($chunks.Count))"
        return $true
    } else {
        Write-Log "FAIL: No session_output chunks in last 200 log lines"
        # Self-improve: check what the last session did
        $lastSession = $lines | Select-String "start_session|starting session|session exited" | Select-Object -Last 5
        Write-Log "CONTEXT (last session activity): $($lastSession -join ' | ')"
        return $false
    }
}

Write-Log "=== DEBUG LOOP START (iterations=$Iterations) ==="
$fixes = @()

for ($i = 1; $i -le $Iterations; $i++) {
    Write-Log "--- Iteration $i ---"

    $r1 = Test-ClaudeAsCurrent
    $r2 = Test-ServiceAccount
    $r3 = Test-PipeOutput
    $r4 = Test-SessionOutput

    if ($r2 -eq $false) {
        $fixes += "CRITICAL: Change service account from LocalSystem to current user"
    }
    if ($r1 -eq $false) {
        $fixes += "CRITICAL: Claude not working for current user - check CLAUDE_CONFIG_DIR and .claude.json"
    }
    if ($r4 -eq $true) {
        Write-Log "SUCCESS: Session output is flowing! Fix is working."
        break
    }

    Write-Log "Waiting 15s before next iteration..."
    Start-Sleep 15
}

Write-Log "=== SUMMARY ==="
if ($fixes.Count -gt 0) {
    Write-Log "Required fixes:"
    $fixes | ForEach-Object { Write-Log "  - $_" }
} else {
    Write-Log "No definitive fixes identified - check debug-loop.log manually"
}
```

- [ ] Commit: `scripts: add automated session output debug loop`

---

## Task 3: Change service to run as current user

**Files:**

- Modify: `agent/internal/cli/service_windows.go`
- Modify: `agent/internal/config/config.go`

- [ ] Add `ServiceUser` field to Config:

```go
// ServiceUser is the Windows account the service runs as.
// Defaults to LocalSystem if empty. Set at install time.
ServiceUser string `toml:"service_user,omitempty"`
```

- [ ] In `service install` command, detect and store the logged-in user:

```go
// Detect current user for service account
currentUser, err := user.Current()
if err == nil && currentUser.Username != "" {
    cfg.ServiceUser = currentUser.Username
}
```

- [ ] When registering the service, use the user account instead of LocalSystem:

```go
// In installService():
// If ServiceUser is set, use it. Otherwise fall back to LocalSystem.
if cfg.ServiceUser != "" {
    // sc.exe config SessionForgeAgent obj= "DOMAIN\user" password= "..."
    // Prompt for password or use a stored credential
}
```

- [ ] Add auto-populate of `claude_config_dir` at install time:

```go
// Detect claude config dir from current user's home
if home, err := os.UserHomeDir(); err == nil {
    claudeConfigDir := filepath.Join(home, ".claude")
    if _, err := os.Stat(claudeConfigDir); err == nil {
        cfg.ClaudeConfigDir = claudeConfigDir
    }
}
```

- [ ] Write tests verifying config fields are populated
- [ ] Run: `go test ./internal/cli/...`
- [ ] Commit: `feat(install): run service as current user, auto-populate claude_config_dir`

---

## Task 4: Fallback — WTSQueryUserToken spawn (if service must stay as LocalSystem)

**Files:**

- Create: `agent/internal/session/spawn_usertoken_windows.go`

This is the fallback if running as a specific user is not viable. Uses `WTSQueryUserToken` to get the active user's session token, then `CreateProcessAsUser` to spawn Claude in their session.

- [ ] Write `spawnAsActiveUser()` using `WTSQueryUserToken` + `CreateProcessAsUser`
- [ ] Wire into `spawnWithPipes` as a fallback when LocalSystem is detected
- [ ] Test: verify output flows when spawning as user token
- [ ] Commit: `feat(session): spawn Claude as active user via WTSQueryUserToken`

---

## Task 5: Automated debug validation

**Files:**

- Create: `agent/internal/session/smoke_windows_test.go`

- [ ] Write a test that spawns Claude via `spawnWithPipes` and asserts output is received within 30s:

```go
//go:build windows && integration

func TestSpawnWithPipes_ProducesOutput(t *testing.T) {
    // ...spawn claude --dangerously-skip-permissions --print "say ping"
    // ...assert output contains "ping" within 30s
}
```

- [ ] Add build tag `integration` so it only runs explicitly
- [ ] Run: `go test -tags=integration ./internal/session/ -run TestSpawnWithPipes_ProducesOutput -v`
- [ ] Commit: `test(session): add integration smoke test for pipes output`

---

## Debug Loop Trigger

After each code change:

1. Build: `go build -o sessionforge.exe ./cmd/sessionforge/`
2. Replace binary and restart service
3. Run: `powershell scripts/debug-session-output.ps1 -Iterations 3`
4. Check: `grep "PASS\|FAIL\|FINDING" ~/.sessionforge/debug-loop.log`
5. If FAIL: read `tasks/lessons.md`, apply relevant lesson, iterate

---

## Success Criteria

- [ ] `session_output chunk` appears in agent.log within 5s of session start
- [ ] Browser terminal shows Claude's welcome message
- [ ] `debug-session-output.ps1` reports all PASS
- [ ] Lesson documented in `tasks/lessons.md`
