//go:build windows

// Package session - Windows PTY implementation using ConPTY (Windows Pseudo Console).
//
// ConPTY provides full terminal emulation on Windows, including ANSI escape sequence
// processing, cursor movement, colour output and resize support — required for
// interactive programs like Claude Code, bash (Git/WSL), and PowerShell.
//
// Minimum supported OS: Windows 10 Build 17763 (October 2018 Update / 1809).
// On older Windows the code falls back transparently to pipe-based I/O.
package session

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// pipeWriter is a raw Windows pipe writer that bypasses Go's IOCP runtime.
// Anonymous pipes on Windows do not support I/O Completion Ports, so wrapping
// them with os.NewFile causes Go to attempt (and silently fail) IOCP association,
// which results in broken I/O. This type calls windows.WriteFile directly.
type pipeWriter struct {
	h  windows.Handle
	mu sync.Mutex
}

func (pw *pipeWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	pw.mu.Lock()
	defer pw.mu.Unlock()
	var written uint32
	err := windows.WriteFile(pw.h, p, &written, nil)
	return int(written), err
}

func (pw *pipeWriter) Close() error {
	pw.mu.Lock()
	defer pw.mu.Unlock()
	return windows.CloseHandle(pw.h)
}

// pipeReader is a raw Windows pipe reader that bypasses Go's IOCP runtime.
// Same rationale as pipeWriter: anonymous pipes do not support IOCP, so
// os.NewFile's Read path fails silently. This type calls windows.ReadFile
// directly, which blocks in the kernel until data is available or the pipe
// is closed — the correct behaviour for a ConPTY output consumer.
type pipeReader struct {
	h  windows.Handle
	mu sync.Mutex
}

func (pr *pipeReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	pr.mu.Lock()
	defer pr.mu.Unlock()
	var n uint32
	err := windows.ReadFile(pr.h, p, &n, nil)
	return int(n), err
}

func (pr *pipeReader) Close() error {
	pr.mu.Lock()
	defer pr.mu.Unlock()
	return windows.CloseHandle(pr.h)
}

// ptyHandle wraps a Windows ConPTY pseudo-console and its child process.
// In pipe-fallback mode (Windows < 1809) cmd is set and hPC is zero.
type ptyHandle struct {
	hPC    windows.Handle // ConPTY handle (0 in pipe-fallback mode)
	proc   *os.Process    // child process (ConPTY path)
	cmd    *exec.Cmd      // child process (pipe-fallback path)
	stdin  io.WriteCloser // write end -> PTY input
	stdout io.ReadCloser  // read end  <- PTY output
	cancel context.CancelFunc
	mu     sync.Mutex
}

// configuredClaudePath is the claude binary path stored in config.toml at install
// time. Set via SetClaudePath by the Manager after loading config. When non-empty
// it is tried first in resolveCommand, before exec.LookPath or the npm fallback.
var (
	configuredClaudePath   string
	configuredClaudePathMu sync.Mutex
)

// SetClaudePath stores the pre-resolved claude binary path from config.toml.
// Called by the daemon startup code after loading config.
func SetClaudePath(path string) {
	configuredClaudePathMu.Lock()
	defer configuredClaudePathMu.Unlock()
	configuredClaudePath = path
}

// allowedCommands is the set of process names the agent may spawn on Windows.
var allowedCommands = map[string]bool{
	"claude":     true,
	"bash":       true,
	"zsh":        true,
	"sh":         true,
	"powershell": true,
	"cmd":        true,
}

// resolveCommand validates the binary name against the allow-list and returns
// the absolute path plus any extra arguments split from the command string.
// e.g. "bash -i" -> ("/usr/bin/bash", ["-i"], nil)
//
// On Windows, if the resolved path is a .cmd script (e.g. npm-installed CLIs),
// CreateProcess cannot execute it directly. In that case the returned binary is
// cmd.exe and the script path is prepended to args so the caller builds:
//
//	"C:\Windows\System32\cmd.exe" /C "C:\...\claude.cmd" [extra-args...]
//
// resolveCommand also searches user-profile npm directories so that tools
// installed with "npm install -g" are found even when the service runs as
// LocalSystem (which only inherits the system PATH, not the user PATH).
func resolveCommand(command string) (string, []string, error) {
	parts := strings.Fields(command)
	if len(parts) == 0 {
		return "", nil, fmt.Errorf("empty command")
	}
	bin := parts[0]
	args := parts[1:]

	base := bin
	if idx := strings.LastIndex(bin, "\\"); idx >= 0 {
		base = bin[idx+1:]
	}
	if idx := strings.LastIndex(base, "/"); idx >= 0 {
		base = base[idx+1:]
	}
	baseLower := strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(base, ".cmd"), ".exe"))
	if !allowedCommands[baseLower] {
		return "", nil, fmt.Errorf("command %q is not allowed; permitted: claude, bash, zsh, sh, powershell, cmd", bin)
	}

	// 1. Check config-stored path first (set at install time while the installer
	//    ran as the user with the correct PATH). Only applies to "claude".
	configuredClaudePathMu.Lock()
	storedPath := configuredClaudePath
	configuredClaudePathMu.Unlock()
	if storedPath != "" && baseLower == "claude" {
		if _, err := os.Stat(storedPath); err == nil {
			resolved := storedPath
			isCmdScript := strings.ToLower(filepath.Ext(resolved)) == ".cmd"
			if isCmdScript {
				cmdExe, cmdErr := exec.LookPath("cmd.exe")
				if cmdErr != nil {
					cmdExe = `C:\Windows\System32\cmd.exe`
				}
				return cmdExe, append([]string{"/C", resolved}, args...), nil
			}
			return resolved, args, nil
		}
	}

	// 2. Standard PATH lookup.
	resolved, lookErr := exec.LookPath(bin)
	if lookErr != nil {
		// Service runs as LocalSystem: user's npm prefix (e.g. AppData\Roaming\npm)
		// is not in the system PATH. Probe known locations so "claude" and other
		// npm-global tools can be found without modifying the system PATH.
		var fallbackErr error
		resolved, fallbackErr = lookPathWithNpmFallback(bin)
		if fallbackErr != nil {
			return "", nil, fmt.Errorf("command %q not found: %w", bin, fallbackErr)
		}
	}

	// Windows CreateProcess cannot execute .cmd script files directly.
	// Wrap them as: cmd.exe /C "<script>" [args...]
	isCmdScript := strings.ToLower(filepath.Ext(resolved)) == ".cmd"

	if isCmdScript {
		cmdExe, cmdErr := exec.LookPath("cmd.exe")
		if cmdErr != nil {
			cmdExe = `C:\Windows\System32\cmd.exe`
		}
		return cmdExe, append([]string{"/C", resolved}, args...), nil
	}

	return resolved, args, nil
}

// cachedClaudePath caches the result of the first successful npm fallback scan
// for the "claude" binary so that C:\Users\ is not walked on every session spawn.
var (
	cachedClaudeResult    string
	cachedClaudeResultErr error
	cachedClaudeOnce      sync.Once
)

// lookPathWithNpmFallback searches for a binary in additional directories that
// are typically in a user's PATH but absent from the LocalSystem service PATH.
// For the "claude" binary the result is cached after the first scan.
func lookPathWithNpmFallback(bin string) (string, error) {
	if strings.ToLower(bin) == "claude" {
		cachedClaudeOnce.Do(func() {
			cachedClaudeResult, cachedClaudeResultErr = scanNpmDirsForBin(bin)
		})
		return cachedClaudeResult, cachedClaudeResultErr
	}
	return scanNpmDirsForBin(bin)
}

// scanNpmDirsForBin probes known npm prefix directories for the named binary.
// It probes directories derived from:
//  1. USERPROFILE env var (may be set by the SCM when launching the service)
//  2. The parent of the executable path (walks up 4 levels from service binary)
//  3. All user profile directories under C:\Users\ as a last resort
func scanNpmDirsForBin(bin string) (string, error) {
	seen := map[string]bool{}
	var extra []string

	addNpmDirs := func(home string) {
		for _, d := range []string{
			filepath.Join(home, "AppData", "Roaming", "npm"),
			filepath.Join(home, "AppData", "Local", "npm"),
		} {
			if !seen[d] {
				seen[d] = true
				extra = append(extra, d)
			}
		}
	}

	// 1. From USERPROFILE env var.
	if up := os.Getenv("USERPROFILE"); up != "" {
		addNpmDirs(up)
	}

	// 2. Infer from the binary's own location: the service binary is at
	//    C:\Users\<user>\AppData\Local\Programs\sessionforge\sessionforge.exe
	//    Walk up 4 levels to reach C:\Users\<user>.
	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(exe))))
		if _, err2 := os.Stat(candidate); err2 == nil {
			addNpmDirs(candidate)
		}
	}

	// 3. Scan C:\Users\ for all profile directories.
	if entries, err := os.ReadDir(`C:\Users`); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				addNpmDirs(filepath.Join(`C:\Users`, e.Name()))
			}
		}
	}

	for _, dir := range extra {
		// Try without extension first — exec.LookPath honours PATHEXT extensions.
		if candidate, err := exec.LookPath(filepath.Join(dir, bin)); err == nil {
			return candidate, nil
		}
		// Explicitly try .cmd suffix (npm-installed CLIs on Windows).
		candidate := filepath.Join(dir, bin+".cmd")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("%q not found in system PATH or known npm directories", bin)
}

// Windows API constants.
const (
	// PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE links a process to a pseudo console.
	procThreadAttributePseudoConsole uintptr = 0x00020016
	// EXTENDED_STARTUPINFO_PRESENT tells CreateProcess the STARTUPINFOEX is used.
	extendedStartupInfoPresent uint32 = 0x00080000
	// CREATE_UNICODE_ENVIRONMENT tells CreateProcess the env block is UTF-16.
	createUnicodeEnvironment uint32 = 0x00000400
)

// spawnPTY attempts ConPTY first and falls back to pipes on older Windows.
func spawnPTY(
	ctx context.Context,
	sessionID string,
	command string,
	workdir string,
	env map[string]string,
	outputFn func(sessionID, data string),
	exitFn func(sessionID string, exitCode int, err error),
) (*ptyHandle, int, error) {
	binary, args, err := resolveCommand(command)
	if err != nil {
		return nil, 0, fmt.Errorf("resolve command: %w", err)
	}

	h, pid, err := spawnWithConPTY(ctx, sessionID, binary, args, workdir, env, outputFn, exitFn)
	if err != nil {
		// ConPTY unavailable (Windows < 1809) -- fall back to pipe I/O.
		return spawnWithPipes(ctx, sessionID, binary, args, workdir, env, outputFn, exitFn)
	}
	return h, pid, nil
}

// spawnWithConPTY creates a real Windows Pseudo Console for full terminal emulation.
func spawnWithConPTY(
	ctx context.Context,
	sessionID string,
	binary string,
	args []string,
	workdir string,
	env map[string]string,
	outputFn func(sessionID, data string),
	exitFn func(sessionID string, exitCode int, err error),
) (*ptyHandle, int, error) {
	// Pipe layout:
	//   inputRead   -> ConPTY reads keystroke data from here
	//   inputWrite  -> We write keystrokes here
	//   outputRead  <- We read terminal output from here
	//   outputWrite <- ConPTY writes rendered terminal output here
	var inputRead, inputWrite windows.Handle
	if err := windows.CreatePipe(&inputRead, &inputWrite, nil, 0); err != nil {
		return nil, 0, fmt.Errorf("create input pipe: %w", err)
	}

	var outputRead, outputWrite windows.Handle
	if err := windows.CreatePipe(&outputRead, &outputWrite, nil, 0); err != nil {
		windows.CloseHandle(inputRead)
		windows.CloseHandle(inputWrite)
		return nil, 0, fmt.Errorf("create output pipe: %w", err)
	}

	// Create the pseudo console with a generous default size.
	// Resize will be called by the terminal once dimensions are known.
	coord := windows.Coord{X: 220, Y: 50}
	var hPC windows.Handle
	if err := windows.CreatePseudoConsole(coord, inputRead, outputWrite, 0, &hPC); err != nil {
		windows.CloseHandle(inputRead)
		windows.CloseHandle(inputWrite)
		windows.CloseHandle(outputRead)
		windows.CloseHandle(outputWrite)
		return nil, 0, fmt.Errorf("CreatePseudoConsole unavailable: %w", err)
	}

	// The ConPTY now owns these ends; close them in the parent.
	windows.CloseHandle(inputRead)
	windows.CloseHandle(outputWrite)

	// Use raw pipe handles instead of os.NewFile for both stdin and stdout.
	// Windows anonymous pipes do not support IOCP; os.NewFile would associate
	// them with Go's async I/O subsystem, causing silent failures: writes
	// deliver EOF to the child and reads return immediately instead of
	// blocking -- both of which cause interactive shells to exit at once.
	stdinPW := &pipeWriter{h: inputWrite}
	stdoutPR := &pipeReader{h: outputRead}

	cmdCtx, cancel := context.WithCancel(ctx)

	// Start the output reader BEFORE CreateProcess so the pipe is drained
	// from the moment the ConPTY first writes VT initialisation sequences.
	readerReady := make(chan struct{})
	go readPipeOutput(sessionID, stdoutPR, outputFn, readerReady)
	<-readerReady

	// Build the PROC_THREAD_ATTRIBUTE_LIST that tells CreateProcess to attach
	// the new process to our pseudo console.
	attrList, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		cancel()
		stdinPW.Close()
		stdoutPR.Close()
		windows.ClosePseudoConsole(hPC)
		return nil, 0, fmt.Errorf("NewProcThreadAttributeList: %w", err)
	}

	if err := attrList.Update(
		procThreadAttributePseudoConsole,
		unsafe.Pointer(hPC),
		unsafe.Sizeof(hPC),
	); err != nil {
		attrList.Delete()
		cancel()
		stdinPW.Close()
		stdoutPR.Close()
		windows.ClosePseudoConsole(hPC)
		return nil, 0, fmt.Errorf("UpdateProcThreadAttribute: %w", err)
	}

	// STARTUPINFOEX embeds a standard STARTUPINFO plus the attribute list pointer.
	siEx := windows.StartupInfoEx{}
	siEx.StartupInfo.Cb = uint32(unsafe.Sizeof(siEx))
	siEx.ProcThreadAttributeList = attrList.List()

	// Build command-line string: quoted binary followed by any extra arguments.
	// Arguments that contain spaces are quoted so CreateProcess parses them correctly.
	cmdLine := `"` + binary + `"`
	for _, arg := range args {
		if strings.ContainsAny(arg, " \t") {
			cmdLine += ` "` + arg + `"`
		} else {
			cmdLine += " " + arg
		}
	}
	cmdLinePtr, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		attrList.Delete()
		cancel()
		stdinPW.Close()
		stdoutPR.Close()
		windows.ClosePseudoConsole(hPC)
		return nil, 0, fmt.Errorf("cmdline utf16: %w", err)
	}

	// Resolve working directory.
	if workdir == "" {
		workdir, _ = os.UserHomeDir()
	}
	workdirPtr, err := windows.UTF16PtrFromString(workdir)
	if err != nil {
		attrList.Delete()
		cancel()
		stdinPW.Close()
		stdoutPR.Close()
		windows.ClosePseudoConsole(hPC)
		return nil, 0, fmt.Errorf("workdir utf16: %w", err)
	}

	// Build environment block.
	envBlock := buildEnvBlock(env)

	creationFlags := extendedStartupInfoPresent | createUnicodeEnvironment
	var procInfo windows.ProcessInformation

	// CreateProcess expects *StartupInfo; we pass the StartupInfoEx by casting.
	// This is the standard pattern for EXTENDED_STARTUPINFO_PRESENT on Windows.
	if err := windows.CreateProcess(
		nil,
		cmdLinePtr,
		nil,
		nil,
		false,
		creationFlags,
		envBlock,
		workdirPtr,
		&siEx.StartupInfo,
		&procInfo,
	); err != nil {
		attrList.Delete()
		cancel()
		stdinPW.Close()
		stdoutPR.Close()
		windows.ClosePseudoConsole(hPC)
		return nil, 0, fmt.Errorf("CreateProcess: %w", err)
	}

	// Attribute list can be freed once the process is created.
	attrList.Delete()
	// Thread handle not needed.
	windows.CloseHandle(procInfo.Thread)

	proc, err := os.FindProcess(int(procInfo.ProcessId))
	if err != nil {
		cancel()
		stdinPW.Close()
		stdoutPR.Close()
		windows.ClosePseudoConsole(hPC)
		windows.CloseHandle(procInfo.Process)
		return nil, 0, fmt.Errorf("FindProcess: %w", err)
	}

	h := &ptyHandle{
		hPC:    hPC,
		proc:   proc,
		stdin:  stdinPW,
		stdout: stdoutPR,
		cancel: cancel,
	}

	go func() {
		defer cancel()
		state, waitErr := proc.Wait()
		stdinPW.Close()
		stdoutPR.Close()
		windows.ClosePseudoConsole(hPC)
		windows.CloseHandle(procInfo.Process)

		if waitErr != nil {
			exitFn(sessionID, -1, waitErr)
			return
		}
		exitCode := 0
		if state != nil && !state.Success() {
			exitCode = state.ExitCode()
		}
		exitFn(sessionID, exitCode, nil)

		_ = cmdCtx
	}()

	return h, int(procInfo.ProcessId), nil
}

// buildEnvBlock constructs a UTF-16 environment block for CreateProcess.
// The block is pairs of KEY=VALUE\0 terminated by an extra \0.
// Returns nil when no pairs are produced (process inherits parent environment).
func buildEnvBlock(overlay map[string]string) *uint16 {
	// Strip vars that must never reach the child process.
	blocked := map[string]bool{
		"CLAUDECODE": true, // prevents "nested session" error
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

// spawnWithPipes is the pipe-based fallback for Windows < 1809 (no ConPTY).
func spawnWithPipes(
	ctx context.Context,
	sessionID string,
	binary string,
	args []string,
	workdir string,
	env map[string]string,
	outputFn func(sessionID, data string),
	exitFn func(sessionID string, exitCode int, err error),
) (*ptyHandle, int, error) {
	cmdCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(cmdCtx, binary, args...)
	cmd.Dir = workdir

	// Build environment: inherit + overlay, stripping CLAUDECODE so the child
	// does not think it is running inside an existing Claude Code session.
	baseEnv := os.Environ()
	filteredEnv := make([]string, 0, len(baseEnv))
	for _, kv := range baseEnv {
		if strings.HasPrefix(kv, "CLAUDECODE=") {
			continue
		}
		filteredEnv = append(filteredEnv, kv)
	}
	cmd.Env = filteredEnv
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.Env = append(cmd.Env, "TERM=xterm-256color")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, 0, fmt.Errorf("stdin pipe: %w", err)
	}

	// Merge stdout + stderr into one reader.
	pr, pw, err := os.Pipe()
	if err != nil {
		cancel()
		stdin.Close()
		return nil, 0, fmt.Errorf("output pipe: %w", err)
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		cancel()
		pw.Close()
		pr.Close()
		stdin.Close()
		return nil, 0, fmt.Errorf("start process: %w", err)
	}
	pw.Close()

	h := &ptyHandle{
		cmd:    cmd,
		stdin:  stdin,
		stdout: pr,
		cancel: cancel,
	}

	go readPipeOutput(sessionID, pr, outputFn, nil)

	go func() {
		waitErr := cmd.Wait()
		code := 0
		if waitErr != nil {
			if exitErr, ok := waitErr.(*exec.ExitError); ok {
				code = exitErr.ExitCode()
			} else {
				exitFn(sessionID, -1, waitErr)
				return
			}
		}
		exitFn(sessionID, code, nil)
	}()

	return h, cmd.Process.Pid, nil
}

// readPipeOutput drains a reader, batches output at ~60fps, and calls outputFn
// with base64-encoded chunks. If ready is non-nil it is closed once the inner
// read goroutine has started, signalling that the pipe has an active consumer.
func readPipeOutput(sessionID string, r io.Reader, outputFn func(string, string), ready chan<- struct{}) {
	buf := make([]byte, 4096)
	ticker := time.NewTicker(16 * time.Millisecond)
	defer ticker.Stop()

	var pending []byte

	flush := func() {
		if len(pending) > 0 {
			encoded := base64.StdEncoding.EncodeToString(pending)
			outputFn(sessionID, encoded)
			pending = pending[:0]
		}
	}

	readCh := make(chan []byte, 64)

	go func() {
		// Signal that this goroutine is running and about to call Read.
		if ready != nil {
			close(ready)
		}
		for {
			n, err := r.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				readCh <- chunk
			}
			if err != nil {
				close(readCh)
				return
			}
		}
	}()

	for {
		select {
		case chunk, ok := <-readCh:
			if !ok {
				flush()
				return
			}
			pending = append(pending, chunk...)
		case <-ticker.C:
			flush()
		}
	}
}

// writeInput decodes base64 data and writes it to the ConPTY input pipe.
func (h *ptyHandle) writeInput(data string) error {
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return fmt.Errorf("base64 decode: %w", err)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err = h.stdin.Write(decoded)
	return err
}

// resize updates the ConPTY window dimensions.
// In pipe-fallback mode this is a no-op (no PTY to resize).
func (h *ptyHandle) resize(cols, rows uint16) error {
	if h.hPC == 0 {
		return nil
	}
	coord := windows.Coord{X: int16(cols), Y: int16(rows)}
	return windows.ResizePseudoConsole(h.hPC, coord)
}

// stop terminates the child process.
func (h *ptyHandle) stop(_ bool) error {
	if h.proc != nil {
		return h.proc.Kill()
	}
	if h.cmd != nil && h.cmd.Process != nil {
		return h.cmd.Process.Kill()
	}
	h.cancel()
	return nil
}

// pause is not supported on Windows (no SIGSTOP equivalent in user-mode).
func (h *ptyHandle) pause() error {
	return fmt.Errorf("pause not supported on Windows")
}

// resume is not supported on Windows (no SIGCONT equivalent in user-mode).
func (h *ptyHandle) resume() error {
	return fmt.Errorf("resume not supported on Windows")
}

// close cancels the context and releases stdin.
func (h *ptyHandle) close() {
	h.cancel()
	h.mu.Lock()
	defer h.mu.Unlock()
	h.stdin.Close()
}
