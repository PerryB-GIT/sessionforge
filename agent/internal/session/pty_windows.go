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
	"log/slog"
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

	// Tier-specific fields (added for tiered spawn).
	tier      string // "wsl", "gitbash", "conpty", or "pipes"
	wslDistro string // WSL distro name (only set for WSL tier)
	linuxPID  int    // Linux-side PID for WSL kill (0 if capture failed)
	sessionID string // For temp file cleanup in WSL tier
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
			if strings.ToLower(filepath.Ext(resolved)) == ".cmd" {
				return resolveCmdScript(resolved, args)
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
	// Parse the .cmd to extract the real node + script invocation so we get a
	// proper long-lived process with working pipes/ConPTY instead of a cmd.exe
	// wrapper that exits immediately and orphans the child.
	if strings.ToLower(filepath.Ext(resolved)) == ".cmd" {
		return resolveCmdScript(resolved, args)
	}

	return resolved, args, nil
}

// resolveCmdScript parses a Windows npm-generated .cmd shim and extracts the
// underlying node.exe + script path so we can spawn the real process directly.
// npm shims follow the pattern:
//
//	"%dp0%\node.exe"  "%dp0%\node_modules\...\cli.js" %*
//
// If parsing fails we fall back to cmd.exe /C (original behaviour).
func resolveCmdScript(cmdPath string, extraArgs []string) (string, []string, error) {
	data, err := os.ReadFile(cmdPath)
	if err != nil {
		return fallbackCmdExe(cmdPath, extraArgs)
	}
	content := string(data)
	dir := filepath.Dir(cmdPath)

	// Look for the execution line: ends with %* and contains a .js file.
	// Example: endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\...\cli.js" %*
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, ".js") || !strings.HasSuffix(strings.TrimSpace(line), "%*") {
			continue
		}
		// Extract quoted tokens — they are the node binary and script path.
		var tokens []string
		rest := line
		for {
			start := strings.Index(rest, `"`)
			if start < 0 {
				break
			}
			end := strings.Index(rest[start+1:], `"`)
			if end < 0 {
				break
			}
			token := rest[start+1 : start+1+end]
			tokens = append(tokens, token)
			rest = rest[start+1+end+1:]
		}
		if len(tokens) < 2 {
			break
		}
		// tokens[0] = node binary or %_prog% placeholder, tokens[1] = script path
		nodeBin := tokens[0]
		scriptPath := tokens[1]

		// Expand %dp0% -> dir of the .cmd file
		nodeBin = strings.ReplaceAll(nodeBin, "%dp0%", dir)
		nodeBin = strings.ReplaceAll(nodeBin, "%DP0%", dir)
		scriptPath = strings.ReplaceAll(scriptPath, "%dp0%", dir)
		scriptPath = strings.ReplaceAll(scriptPath, "%DP0%", dir)

		// If node binary is a placeholder or doesn't exist, use node from PATH.
		if strings.Contains(nodeBin, "%") || nodeBin == "" {
			if n, nerr := exec.LookPath("node.exe"); nerr == nil {
				nodeBin = n
			} else {
				nodeBin = "node"
			}
		}
		if _, serr := os.Stat(scriptPath); serr != nil {
			break // script not found — fall back
		}

		finalArgs := append([]string{scriptPath}, extraArgs...)
		return nodeBin, finalArgs, nil
	}

	// Parsing failed — fall back to cmd.exe /C (no interactive TUI but functional).
	return fallbackCmdExe(cmdPath, extraArgs)
}

// fallbackCmdExe wraps a .cmd script with cmd.exe /C as a last resort.
func fallbackCmdExe(cmdPath string, args []string) (string, []string, error) {
	cmdExe, err := exec.LookPath("cmd.exe")
	if err != nil {
		cmdExe = `C:\Windows\System32\cmd.exe`
	}
	return cmdExe, append([]string{"/C", cmdPath}, args...), nil
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

// conPTYWorking is set by runTierDetection (via probeConPTY) and read by spawnPTY.
// conPTYWorkingOnce ensures the probe runs at most once when WarmUpSpawnTier is
// not called before the first session request.
var (
	conPTYWorkingOnce   sync.Once
	conPTYWorking       bool
	conPTYWorkingLogger *slog.Logger
)

// probeConPTY creates a ConPTY, spawns "cmd.exe /C echo PROBE", and verifies
// that bytes actually arrive on the output pipe within 3 seconds.
// This catches machines where CreatePseudoConsole succeeds and the child
// starts, but the ConDrv/conhost infrastructure is broken and no output ever
// flows (exit code 0xC0000142 or silent hang).
func probeConPTY() bool {
	var ir, iw, or_, ow windows.Handle
	if windows.CreatePipe(&ir, &iw, nil, 0) != nil {
		return false
	}
	if windows.CreatePipe(&or_, &ow, nil, 0) != nil {
		windows.CloseHandle(ir)
		windows.CloseHandle(iw)
		return false
	}
	coord := windows.Coord{X: 80, Y: 25}
	var hPC windows.Handle
	if windows.CreatePseudoConsole(coord, ir, ow, 0, &hPC) != nil {
		windows.CloseHandle(ir)
		windows.CloseHandle(iw)
		windows.CloseHandle(or_)
		windows.CloseHandle(ow)
		return false
	}
	// Parent closes these ends now that the ConPTY owns them.
	windows.CloseHandle(ir)
	windows.CloseHandle(ow)

	attrList, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		windows.CloseHandle(or_)
		windows.ClosePseudoConsole(hPC)
		windows.CloseHandle(iw)
		return false
	}
	if err := attrList.Update(procThreadAttributePseudoConsole, unsafe.Pointer(&hPC), unsafe.Sizeof(hPC)); err != nil {
		attrList.Delete()
		windows.CloseHandle(or_)
		windows.ClosePseudoConsole(hPC)
		windows.CloseHandle(iw)
		return false
	}

	siEx := windows.StartupInfoEx{}
	siEx.StartupInfo.Cb = uint32(unsafe.Sizeof(siEx))
	siEx.ProcThreadAttributeList = attrList.List()

	// Use cmd.exe echo as the probe — simple, fast, reliable across all sessions.
	// node.exe was used previously but hangs when ConPTY infrastructure is broken,
	// causing ReadFile to block even after TerminateProcess. cmd.exe echo exits
	// immediately and reliably unblocks the output pipe.
	probeCmd := `"C:\Windows\System32\cmd.exe" /C echo CONPTY-PROBE`
	cmdLinePtr, _ := windows.UTF16PtrFromString(probeCmd)
	var pi windows.ProcessInformation

	spawnErr := windows.CreateProcess(nil, cmdLinePtr, nil, nil, false,
		extendedStartupInfoPresent|createUnicodeEnvironment, nil, nil, &siEx.StartupInfo, &pi)
	attrList.Delete()

	if spawnErr != nil {
		windows.CloseHandle(or_)
		windows.ClosePseudoConsole(hPC)
		windows.CloseHandle(iw)
		return false
	}
	windows.CloseHandle(pi.Thread)

	// Wait for the probe process to exit (max 2s), then close the ConPTY so
	// the output pipe gets EOF and ReadFile returns. Without closing the ConPTY
	// first, ReadFile on the output pipe blocks indefinitely even after the child
	// exits — the pipe stays open until all ConPTY handles are closed.
	waitResult, _ := windows.WaitForSingleObject(pi.Process, 2000)
	windows.TerminateProcess(pi.Process, 1) // no-op if already exited
	windows.CloseHandle(pi.Process)
	_ = waitResult

	// ReadFile first — or_ is still open so conhost can write its output.
	// Use a short timeout via a goroutine since we can't pass a deadline to ReadFile.
	// We read whatever arrived (the echo output), then close or_.
	// Closing or_ before ClosePseudoConsole is critical: conhost won't exit
	// (and ClosePseudoConsole won't return) while a reader holds or_ open.
	buf := make([]byte, 256)
	var n uint32
	readDone := make(chan error, 1)
	go func() {
		var readN uint32
		err := windows.ReadFile(or_, buf, &readN, nil)
		n = readN
		readDone <- err
	}()

	// Give the process 1s to write output before we give up and close the pipe.
	var readErr error
	select {
	case readErr = <-readDone:
		// ReadFile returned normally.
	case <-time.After(1 * time.Second):
		// Timed out — close or_ to unblock the goroutine.
	}

	windows.CloseHandle(or_) // close reader — unblocks conhost output drain

	// ClosePseudoConsole can hang on some Windows 10 builds (conhost doesn't
	// always exit cleanly). Run it in a goroutine with a 2s timeout.
	closeDone := make(chan struct{}, 1)
	go func() {
		windows.ClosePseudoConsole(hPC)
		closeDone <- struct{}{}
	}()
	select {
	case <-closeDone:
	case <-time.After(2 * time.Second):
		// Timed out — conhost is stuck. The goroutine leaks but the probe
		// result is already determined by whether we read bytes above.
	}
	windows.CloseHandle(iw)

	ok := readErr == nil && n > 0
	return ok
}

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
	ensureTierDetected()

	if conPTYWorkingLogger != nil {
		conPTYWorkingLogger.Info("spawnPTY: routing session",
			"tier", spawnTier, "command", command, "sessionId", sessionID,
		)
	}

	switch spawnTier {
	case "wsl":
		return spawnWithWSL(ctx, sessionID, command, workdir, env, outputFn, localOutputFn, exitFn)
	case "gitbash":
		return spawnWithGitBash(ctx, sessionID, command, workdir, env, outputFn, localOutputFn, exitFn)
	default:
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

// SetConPTYLogger wires a logger into the ConPTY probe so the probe result is
// visible in the agent log. Called by the Manager after the logger is available.
func SetConPTYLogger(l *slog.Logger) {
	conPTYWorkingLogger = l
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
	localOutputFn func(raw []byte),
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
	go readPipeOutput(sessionID, stdoutPR, outputFn, localOutputFn, readerReady)
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
		unsafe.Pointer(&hPC), //nolint:govet // hPC is a Windows HANDLE (uintptr); taking its address is safe here
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

	if conPTYWorkingLogger != nil {
		conPTYWorkingLogger.Info("spawnWithConPTY: process created", "pid", procInfo.ProcessId, "sessionId", sessionID)
	}

	go func() {
		defer cancel()
		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Info("spawnWithConPTY: waiting for process exit", "pid", procInfo.ProcessId, "sessionId", sessionID)
		}
		state, waitErr := proc.Wait()
		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Info("spawnWithConPTY: process exited", "pid", procInfo.ProcessId, "sessionId", sessionID)
		}
		stdinPW.Close()
		stdoutPR.Close()
		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Info("spawnWithConPTY: closing pseudo console", "pid", procInfo.ProcessId, "sessionId", sessionID)
		}
		windows.ClosePseudoConsole(hPC)
		if conPTYWorkingLogger != nil {
			conPTYWorkingLogger.Info("spawnWithConPTY: pseudo console closed", "pid", procInfo.ProcessId, "sessionId", sessionID)
		}
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

// spawnWithPipes is the pipe-based fallback used when ConPTY is unavailable.
// It uses windows.CreateProcess directly (not exec.Cmd) so we can set
// CREATE_NO_WINDOW | DETACHED_PROCESS and STARTF_USESTDHANDLES in the same
// call — Go's exec.Cmd does not reliably honour CreationFlags when stdin/stdout
// pipes are wired up, causing cmd.exe to attach to the user's console session
// instead of using the anonymous pipes.
func spawnWithPipes(
	ctx context.Context,
	sessionID string,
	binary string,
	args []string,
	workdir string,
	env map[string]string,
	outputFn func(sessionID, data string),
	localOutputFn func(raw []byte),
	exitFn func(sessionID string, exitCode int, err error),
) (*ptyHandle, int, error) {
	_, cancel := context.WithCancel(ctx)

	// --- stdin pipe (parent writes, child reads) ---
	// The child-read end must be inheritable; the parent-write end must not be.
	sa := windows.SecurityAttributes{InheritHandle: 1}
	sa.Length = uint32(unsafe.Sizeof(sa))

	var stdinR, stdinW windows.Handle
	if err := windows.CreatePipe(&stdinR, &stdinW, &sa, 0); err != nil {
		cancel()
		return nil, 0, fmt.Errorf("create stdin pipe: %w", err)
	}
	// Make the parent-write end non-inheritable.
	if err := windows.SetHandleInformation(stdinW, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		cancel()
		return nil, 0, fmt.Errorf("set stdin write non-inheritable: %w", err)
	}

	// --- stdout+stderr pipe (child writes, parent reads) ---
	var outR, outW windows.Handle
	if err := windows.CreatePipe(&outR, &outW, &sa, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		cancel()
		return nil, 0, fmt.Errorf("create output pipe: %w", err)
	}
	// Make the parent-read end non-inheritable.
	if err := windows.SetHandleInformation(outR, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		windows.CloseHandle(stdinR)
		windows.CloseHandle(stdinW)
		windows.CloseHandle(outR)
		windows.CloseHandle(outW)
		cancel()
		return nil, 0, fmt.Errorf("set output read non-inheritable: %w", err)
	}

	// Build STARTUPINFO with STARTF_USESTDHANDLES to wire our pipes.
	const startfUsestdhandles uint32 = 0x00000100
	si := windows.StartupInfo{
		Flags:      startfUsestdhandles,
		StdInput:   stdinR,
		StdOutput:  outW,
		StdErr:     outW,
	}
	si.Cb = uint32(unsafe.Sizeof(si))

	// Build command line string.
	cmdLine := windows.EscapeArg(binary)
	for _, a := range args {
		cmdLine += " " + windows.EscapeArg(a)
	}
	cmdLinePtr, _ := windows.UTF16PtrFromString(cmdLine)

	// Working directory.
	var workdirPtr *uint16
	if workdir != "" && workdir != "." {
		workdirPtr, _ = windows.UTF16PtrFromString(workdir)
	}

	// Environment block.
	envBlock := buildEnvBlock(env)

	// CREATE_NO_WINDOW: child gets no console window.
	// DETACHED_PROCESS: child is detached from the parent's console entirely.
	// CREATE_UNICODE_ENVIRONMENT: env block is UTF-16.
	const createNoWindow uint32 = 0x08000000
	const detachedProcess uint32 = 0x00000008
	creationFlags := createNoWindow | detachedProcess | createUnicodeEnvironment

	var procInfo windows.ProcessInformation
	if err := windows.CreateProcess(
		nil, cmdLinePtr,
		nil, nil,
		true, // inherit handles (our inheritable pipe ends)
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
		return nil, 0, fmt.Errorf("CreateProcess: %w", err)
	}

	// Close the child-side handles in the parent — child owns them now.
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
		stdin:  stdinWriter,
		stdout: outReader,
		cancel: cancel,
	}

	go readPipeOutput(sessionID, outReader, outputFn, localOutputFn, nil)

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

// readPipeOutput drains a reader, batches output at ~60fps, and calls outputFn
// with base64-encoded chunks. If localOutputFn is non-nil it is called with raw
// bytes before base64 encoding. If ready is non-nil it is closed once the inner
// read goroutine has started, signalling that the pipe has an active consumer.
func readPipeOutput(sessionID string, r io.Reader, outputFn func(string, string), localOutputFn func([]byte), ready chan<- struct{}) {
	buf := make([]byte, 4096)
	ticker := time.NewTicker(16 * time.Millisecond)
	defer ticker.Stop()

	var pending []byte

	flush := func() {
		if len(pending) > 0 {
			if localOutputFn != nil {
				localOutputFn(pending)
			}
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

// writeInputRaw forwards raw bytes to the PTY stdin without base64 decoding.
// Used by StartWithLocalOutput / WriteInputRaw for local terminal passthrough.
func (h *ptyHandle) writeInputRaw(data []byte) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := h.stdin.Write(data)
	return err
}

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

// stop terminates the child process. Behavior depends on tier and force flag.
func (h *ptyHandle) stop(force bool) error {
	switch h.tier {
	case "wsl":
		return h.stopWSL(force)
	default:
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

	if h.linuxPID == 0 {
		return h.gracefulStop()
	}
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
