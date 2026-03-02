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
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ptyHandle wraps a Windows ConPTY pseudo-console and its child process.
// In pipe-fallback mode (Windows < 1809) cmd is set and hPC is zero.
type ptyHandle struct {
	hPC    windows.Handle // ConPTY handle (0 in pipe-fallback mode)
	proc   *os.Process    // child process (ConPTY path)
	cmd    *exec.Cmd      // child process (pipe-fallback path)
	stdin  io.WriteCloser // write end → PTY input
	stdout io.ReadCloser  // read end  ← PTY output
	cancel context.CancelFunc
	mu     sync.Mutex
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
// e.g. "bash -i" → ("/usr/bin/bash", ["-i"], nil)
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
	baseLower := strings.ToLower(strings.TrimSuffix(base, ".exe"))
	if !allowedCommands[baseLower] {
		return "", nil, fmt.Errorf("command %q is not allowed; permitted: claude, bash, zsh, sh, powershell, cmd", bin)
	}
	resolved, err := exec.LookPath(bin)
	return resolved, args, err
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
		// ConPTY unavailable (Windows < 1809) — fall back to pipe I/O.
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
	//   inputRead   → ConPTY reads keystroke data from here
	//   inputWrite  → We write keystrokes here
	//   outputRead  ← We read terminal output from here
	//   outputWrite ← ConPTY writes rendered terminal output here
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

	// Build the PROC_THREAD_ATTRIBUTE_LIST that tells CreateProcess to attach
	// the new process to our pseudo console.
	attrList, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		windows.CloseHandle(inputWrite)
		windows.CloseHandle(outputRead)
		windows.ClosePseudoConsole(hPC)
		return nil, 0, fmt.Errorf("NewProcThreadAttributeList: %w", err)
	}

	if err := attrList.Update(
		procThreadAttributePseudoConsole,
		unsafe.Pointer(hPC),
		unsafe.Sizeof(hPC),
	); err != nil {
		attrList.Delete()
		windows.CloseHandle(inputWrite)
		windows.CloseHandle(outputRead)
		windows.ClosePseudoConsole(hPC)
		return nil, 0, fmt.Errorf("UpdateProcThreadAttribute: %w", err)
	}

	// STARTUPINFOEX embeds a standard STARTUPINFO plus the attribute list pointer.
	siEx := windows.StartupInfoEx{}
	siEx.StartupInfo.Cb = uint32(unsafe.Sizeof(siEx))
	siEx.ProcThreadAttributeList = attrList.List()

	// Build command-line string: quoted binary followed by any extra arguments.
	cmdLine := `"` + binary + `"`
	for _, arg := range args {
		cmdLine += " " + arg
	}
	cmdLinePtr, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		attrList.Delete()
		windows.CloseHandle(inputWrite)
		windows.CloseHandle(outputRead)
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
		windows.CloseHandle(inputWrite)
		windows.CloseHandle(outputRead)
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
		windows.CloseHandle(inputWrite)
		windows.CloseHandle(outputRead)
		windows.ClosePseudoConsole(hPC)
		return nil, 0, fmt.Errorf("CreateProcess: %w", err)
	}

	// Attribute list can be freed once the process is created.
	attrList.Delete()
	// Thread handle not needed.
	windows.CloseHandle(procInfo.Thread)

	cmdCtx, cancel := context.WithCancel(ctx)

	stdinFile := os.NewFile(uintptr(inputWrite), "conpty-stdin")
	stdoutFile := os.NewFile(uintptr(outputRead), "conpty-stdout")

	proc, err := os.FindProcess(int(procInfo.ProcessId))
	if err != nil {
		cancel()
		stdinFile.Close()
		stdoutFile.Close()
		windows.ClosePseudoConsole(hPC)
		windows.CloseHandle(procInfo.Process)
		return nil, 0, fmt.Errorf("FindProcess: %w", err)
	}

	h := &ptyHandle{
		hPC:    hPC,
		proc:   proc,
		stdin:  stdinFile,
		stdout: stdoutFile,
		cancel: cancel,
	}

	go readPipeOutput(sessionID, stdoutFile, outputFn)

	go func() {
		defer cancel()
		state, waitErr := proc.Wait()
		stdinFile.Close()
		stdoutFile.Close()
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
// Returns nil on error (process inherits parent environment).
func buildEnvBlock(overlay map[string]string) *uint16 {
	base := os.Environ()
	merged := make(map[string]string, len(base)+len(overlay)+1)
	for _, kv := range base {
		if idx := strings.IndexByte(kv, '='); idx > 0 {
			merged[kv[:idx]] = kv[idx+1:]
		}
	}
	for k, v := range overlay {
		merged[k] = v
	}
	merged["TERM"] = "xterm-256color"

	// Build null-separated KEY=VALUE pairs, double-null terminated.
	var pairs []uint16
	for k, v := range merged {
		entry := k + "=" + v
		encoded, err := syscall.UTF16FromString(entry)
		if err != nil {
			continue
		}
		pairs = append(pairs, encoded...) // includes the null terminator
	}
	pairs = append(pairs, 0) // final double-null

	if len(pairs) == 0 {
		return nil
	}
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
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

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

	go readPipeOutput(sessionID, pr, outputFn)

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
// with base64-encoded chunks.
func readPipeOutput(sessionID string, r io.Reader, outputFn func(string, string)) {
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
