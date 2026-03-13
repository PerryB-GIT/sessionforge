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
