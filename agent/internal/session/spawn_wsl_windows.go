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
// command is the raw command string; the WSL shell handles resolution.
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

	wslWorkdir := "$HOME"
	if workdir != "" && workdir != "." {
		if wp, ok := windowsToWSLPath(workdir); ok {
			wslWorkdir = wp
		}
	}

	pidFile := fmt.Sprintf("/tmp/sf-%s.pid", sessionID)
	// `script -qfc` forces a PTY so Claude Code thinks it has a TTY and renders
	// its interactive UI. However, Windows binaries running via WSL interop
	// (paths like /mnt/host/c/...) don't work with Linux PTYs — script hangs.
	// For those, skip script and run directly (no TTY, pipes only).
	escapedCmd := strings.ReplaceAll(command, "'", `'\''`)
	isWindowsInterop := strings.Contains(command, "/mnt/host/") || strings.Contains(command, "/mnt/c/")
	var shellCmd string
	if isWindowsInterop {
		shellCmd = fmt.Sprintf("echo $$ > %s && cd '%s' && %s", pidFile, wslWorkdir, escapedCmd)
	} else {
		shellCmd = fmt.Sprintf("echo $$ > %s && cd '%s' && script -qfc '%s' /dev/null", pidFile, wslWorkdir, escapedCmd)
	}

	binary := wslBin
	args := []string{"-d", distro, "--", "sh", "-c", shellCmd}

	mergedEnv := make(map[string]string)
	for k, v := range env {
		mergedEnv[k] = v
	}
	mergedEnv["FORCE_COLOR"] = "1"
	mergedEnv["TERM"] = "xterm-256color"

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

	const startfUsestdhandles uint32 = 0x00000100
	si := windows.StartupInfo{
		Flags:     startfUsestdhandles,
		StdInput:  stdinR,
		StdOutput: outW,
		StdErr:    outW,
	}
	si.Cb = uint32(unsafe.Sizeof(si))

	cmdLine := windows.EscapeArg(binary)
	for _, a := range args {
		cmdLine += " " + windows.EscapeArg(a)
	}
	cmdLinePtr, _ := windows.UTF16PtrFromString(cmdLine)

	envBlock := buildEnvBlock(mergedEnv)

	const createNoWindow uint32 = 0x08000000
	creationFlags := createNoWindow | createUnicodeEnvironment

	var procInfo windows.ProcessInformation
	if err := windows.CreateProcess(
		nil, cmdLinePtr,
		nil, nil,
		true,
		creationFlags,
		envBlock,
		nil,
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

// captureWSLPID reads the Linux PID from the sideband temp file.
// Polls for up to 3 seconds using a short-lived WSL command.
func captureWSLPID(distro, sessionID string) int {
	pidFile := fmt.Sprintf("/tmp/sf-%s.pid", sessionID)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

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
