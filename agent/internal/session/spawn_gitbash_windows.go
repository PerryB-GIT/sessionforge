// agent/internal/session/spawn_gitbash_windows.go
//go:build windows

package session

import (
	"context"
	"fmt"
	"os"
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
	args := []string{"-l", "-c", shellCmd}

	mergedEnv := make(map[string]string)
	for k, v := range env {
		mergedEnv[k] = v
	}
	mergedEnv["FORCE_COLOR"] = "1"
	mergedEnv["TERM"] = "xterm-256color"
	if up := os.Getenv("USERPROFILE"); up != "" {
		mergedEnv["HOME"] = up
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

	envBlock := buildEnvBlock(mergedEnv)

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
