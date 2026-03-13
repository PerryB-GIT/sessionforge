# SessionForge — Lessons Learned

## L001 · 2026-03-12: Node.js requires overlapped (IOCP) pipe handles on Windows

**Rule:** When spawning node.exe via `CreateProcess`, the stdout/stdin pipe handles MUST be created with `FILE_FLAG_OVERLAPPED`. Anonymous `CreatePipe` handles are non-overlapped; libuv (node's I/O layer) uses IOCP internally and silently drops writes to non-overlapped pipes.

**Why:** libuv calls `uv_guess_handle_type` on stdout at startup. If it's a pipe, libuv initializes it as `UV_NAMED_PIPE` and uses `WriteFileEx`/overlapped I/O. A non-overlapped pipe handle causes the write to fail silently — node's stdout produces zero bytes.

**Fix:** Use `CreateNamedPipe` with `FILE_FLAG_OVERLAPPED | PIPE_ACCESS_DUPLEX` for the write end, or use `os.Pipe()` (Go stdlib) which creates overlapped handles automatically.

**Apply when:** Any `CreateProcess`-based spawn of node.exe or any libuv-based process (node, Deno, etc.) using anonymous pipes for stdout capture.

**Evidence:** `spawn-diag.exe` (raw CreateProcess) → 0 bytes. `pipedump.exe` (exec.Cmd/os.Pipe) → Hello! output. Same binary, same args, only pipe creation method differs.

---

## L002 · 2026-03-12: LocalSystem cannot access WSL

**Rule:** Do NOT rely on WSL tier when the service runs as LocalSystem.

**Why:** WSL is per-user. All `wsl.exe` calls from LocalSystem return `exit status 0xffffffff`.

**Apply when:** Tier detection, any spawn from a Windows service running as LocalSystem.

---

## L003 · 2026-03-12: Always pass --dangerously-skip-permissions for non-interactive Claude

**Rule:** Always append `--dangerously-skip-permissions` when spawning Claude without a real TTY.

**Why:** Claude prompts "trust this directory?" interactively. Without a TTY it hangs forever.

**Apply when:** Any Claude spawn via pipes, ConPTY from service context, automated scripts.

---

## L004 · 2026-03-12: CLAUDE_CONFIG_DIR must be set for LocalSystem spawns

**Rule:** Always inject `CLAUDE_CONFIG_DIR` pointing to the user's `~/.claude` when spawning as LocalSystem.

**Why:** LocalSystem has no `~/.claude`; Claude returns "Not logged in" without credentials.

**Apply when:** Service install must auto-detect and store `claude_config_dir` in config.toml.

---

## L005 · 2026-03-12: DETACHED_PROCESS breaks STARTF_USESTDHANDLES on some Windows builds

**Rule:** Do NOT combine `DETACHED_PROCESS` with `STARTF_USESTDHANDLES` in `CreateProcess`.

**Why:** On some Windows 10/11 builds these flags together prevent pipe handle inheritance.

**Apply when:** Any Windows `CreateProcess` call using anonymous pipes for I/O redirection.

---

## L006 · 2026-03-12: Test in actual execution context before writing spawn code

**Rule:** ALWAYS test spawn code running as the actual service account (LocalSystem or user) before assuming it works.

**Why:** `exec.Cmd` tests as a regular user do NOT predict `CreateProcess` behavior as LocalSystem. The two use different pipe types (overlapped vs non-overlapped), different PATH, different home dirs.

**Apply when:** Any change to spawn logic, process creation, environment setup.

---

## L008 · 2026-03-12: spawnWithPipes rewritten to exec.Cmd — confirmed fix for zero output

**Rule:** `spawnWithPipes` now uses `exec.Cmd` + `os.Pipe()` instead of raw `CreateProcess` + `windows.CreatePipe`.

**Root cause (see L001):** `windows.CreatePipe` creates non-overlapped handles. libuv/node.js requires overlapped (IOCP) handles. Silent failure = zero bytes on stdout.

**Fix:** `exec.Cmd` calls `os.Pipe()` via the Go runtime, which sets `FILE_FLAG_OVERLAPPED` automatically. Output flows immediately.

**Regression guard:** `TestSpawnWithPipes_NodeOutputFlows` in `agent/internal/session/smoke_pipes_windows_test.go` (build tag: `windows && integration`). Run: `go test -tags=integration -run TestSpawnWithPipes_NodeOutputFlows ./internal/session/ -v`

**Apply when:** Any future refactor of `spawnWithPipes` — do NOT revert to `windows.CreatePipe`.

---

## L007 · 2026-03-12: exec.Cmd works; raw CreateProcess with anonymous pipes doesn't for node.js

**Rule:** Prefer `exec.Cmd` + `cmd.StdoutPipe()` over raw `CreateProcess` + `windows.CreatePipe` when the child process is node.js.

**Why:** `exec.Cmd` uses `os.Pipe()` which creates overlapped handles. Raw `CreatePipe` creates non-overlapped handles that libuv silently fails to write to.

**Fix path:** Either switch `spawnWithPipes` to use `exec.Cmd`, or replace `CreatePipe` with `CreateNamedPipe(FILE_FLAG_OVERLAPPED)`.

**Apply when:** All Windows pipe-based spawning of node.js processes.

---

## L009 · 2026-03-12: Debugging Rules of Engagement

These rules govern how all debugging is conducted on this project. They apply to every engineer and every AI agent.

### Rule 1 — Reproduce quickly; save the failing input
Before touching any code, reproduce the failure and capture the minimal input that triggers it (log line, request payload, test case). A bug you cannot reproduce consistently is a bug you cannot safely fix. Save the reproduction artifact — it becomes the regression test.

**Why:** Three sessions were spent guessing at the zero-output bug before `spawn-diag.exe` captured the exact reproduction (0 bytes, anonymous pipe, node.exe). Once saved, the fix was trivial.

**How to apply:** First action on any bug report — write a script or test that reproduces it. If it won't reproduce, gather more data before proposing fixes.

### Rule 2 — Ask for a path + risk summary first, not a blind patch
Before implementing, produce: (a) the probable root cause with evidence, (b) the files/functions affected, (c) the risks of the proposed change. No code until this summary exists and has been reviewed.

**Why:** Blind patches stack on each other. Every fix that doesn't start from a confirmed root cause adds noise and may mask the real issue.

**How to apply:** When asking Claude to fix a bug, lead with: "Give me a path and risk summary first." Review it before saying "implement."

### Rule 3 — Turn successful prompts into slash commands for next time
When a debugging prompt, diagnostic sequence, or investigation pattern works well, convert it into a reusable slash command or script. Don't repeat the same manual steps next session.

**Why:** `scripts/check-session-output.ps1` and `spawn-diag.exe` exist because the manual log-grepping steps were repeated three times. Codify once, reuse forever.

**How to apply:** After resolving any bug — ask "should this become a script or slash command?" If yes, create it before closing the session.

### Rule 4 — Run /security-review locally and in CI when the bug touches auth, cookies, headers, or parsing
Any fix that modifies: authentication, session handling, cookie logic, HTTP headers, input parsing, environment variable injection, or process spawning arguments — must pass a security review before merge. Run `/security-review` locally first, then add it to the CI gate for that path.

**Why:** Process spawning (this bug) involved injecting environment variables and command arguments into child processes. That surface is an injection risk. A security review catches it before it ships.

**How to apply:** Check the diff. If any of the above surfaces are touched — run `/security-review`. No exceptions for "simple" fixes.

### Rule 5 — Land a test that would have caught it. Future-proof > heroics
Every bug fix must be accompanied by a test that would have caught the original bug. A fix without a test is a fix that will regress. The test is not optional; it is part of the definition of done.

**Why:** `smoke_pipes_windows_test.go` (TestSpawnWithPipes_NodeOutputFlows) now guards against reverting to `windows.CreatePipe`. Without it, the zero-output bug could silently return in any future refactor.

**How to apply:** Before marking a bug fixed — ask "what test would have caught this?" Write it. The test must fail on the unfixed code and pass on the fixed code.
