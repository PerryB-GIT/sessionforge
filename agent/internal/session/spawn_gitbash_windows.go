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
// bash.exe is a Windows executable — spawned with CreateProcess + pipes.
// command is the raw command string; bash -l -c handles PATH resolution.
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

	shellCmd := command
	binary := bashPath
	// Do NOT use -l (login shell) — sourcing .bash_profile hangs when HOME
	// is misconfigured (e.g. running as LocalSystem with no real user profile).
	args := []string{"-c", shellCmd}

	mergedEnv := make(map[string]string)
	for k, v := range env {
		mergedEnv[k] = v
	}
	mergedEnv["FORCE_COLOR"] = "1"
	mergedEnv["TERM"] = "xterm-256color"

	// When running as LocalSystem, USERPROFILE points to the system profile.
	// Override HOME and PATH so bash -l finds npm-installed claude.
	userProfile := os.Getenv("USERPROFILE")
	if userProfile == "" || strings.Contains(strings.ToLower(userProfile), "systemprofile") {
		// Find the first real user profile that has npm/claude installed.
		for _, candidate := range []string{
			`C:\Users\Jakeb`,
			`C:\Users\Perry`,
		} {
			if _, err := os.Stat(candidate + `\AppData\Roaming\npm\claude.cmd`); err == nil {
				userProfile = candidate
				break
			}
		}
	}
	if userProfile != "" {
		mergedEnv["HOME"] = strings.ReplaceAll(userProfile, `\`, "/")
		npmPath := userProfile + `\AppData\Roaming\npm`
		existing := os.Getenv("PATH")
		mergedEnv["PATH"] = npmPath + string(os.PathListSeparator) + existing
	}

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

	var workdirPtr *uint16
	if workdir != "" && workdir != "." {
		workdirPtr, _ = windows.UTF16PtrFromString(workdir)
	}

	// Pass nil env block so bash inherits the service's environment including PATH.
	// We call node with an absolute path so PATH doesn't need npm in it.
	// buildEnvBlock strips PATH which prevents bash from running at all.
	_ = mergedEnv
	var envBlock *uint16 = nil

	const createNoWindow uint32 = 0x08000000
	// Do NOT use DETACHED_PROCESS — it disconnects the process from any console
	// and causes Node.js/libuv to fail initializing stdio, producing no output.
	creationFlags := createNoWindow | createUnicodeEnvironment

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
