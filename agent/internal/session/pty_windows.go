//go:build windows

// Package session - Windows PTY implementation using pipes (no PTY on Windows).
// On Windows we spawn the process with pipes instead of a PTY.
// Full ConPTY support can be added later via golang.org/x/sys/windows.
package session

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

// ptyHandle wraps the process I/O for Windows (pipe-based, not a real PTY).
type ptyHandle struct {
	stdin  io.WriteCloser
	stdout io.ReadCloser
	cmd    *exec.Cmd
	cancel context.CancelFunc
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

// resolveCommand looks up a command binary, enforcing the allow-list.
func resolveCommand(command string) (string, error) {
	base := command
	if idx := strings.LastIndex(command, "\\"); idx >= 0 {
		base = command[idx+1:]
	}
	if idx := strings.LastIndex(base, "/"); idx >= 0 {
		base = base[idx+1:]
	}
	// Strip .exe suffix for comparison.
	baseLower := strings.ToLower(strings.TrimSuffix(base, ".exe"))
	if !allowedCommands[baseLower] {
		return "", fmt.Errorf("command %q is not allowed; permitted: claude, bash, zsh, sh, powershell, cmd", command)
	}
	return exec.LookPath(command)
}

// spawnPTY starts a process with stdin/stdout pipes on Windows.
// outputFn receives base64-encoded output; exitFn is called on process exit.
func spawnPTY(
	ctx context.Context,
	sessionID string,
	command string,
	workdir string,
	env map[string]string,
	outputFn func(sessionID, data string),
	exitFn func(sessionID string, exitCode int, err error),
) (*ptyHandle, int, error) {
	binary, err := resolveCommand(command)
	if err != nil {
		return nil, 0, fmt.Errorf("resolve command: %w", err)
	}

	cmdCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(cmdCtx, binary)
	cmd.Dir = workdir

	// Build environment.
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, 0, fmt.Errorf("stdin pipe: %w", err)
	}

	// Merge stdout + stderr into a single read pipe.
	pr, pw, err := os.Pipe()
	if err != nil {
		cancel()
		stdin.Close()
		return nil, 0, fmt.Errorf("output pipe: %w", err)
	}
	cmd.Stdout = pw
	cmd.Stderr = pw
	stdout := pr

	if err := cmd.Start(); err != nil {
		cancel()
		pw.Close()
		pr.Close()
		stdin.Close()
		return nil, 0, fmt.Errorf("start process: %w", err)
	}
	// Close write end in the parent process so the read end sees EOF when the
	// child exits.
	pw.Close()

	h := &ptyHandle{
		stdin:  stdin,
		stdout: stdout,
		cmd:    cmd,
		cancel: cancel,
	}

	go readPipeOutput(sessionID, stdout, outputFn)

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

// readPipeOutput reads from a pipe, debounces at 16ms, and calls outputFn.
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

// writeInput decodes base64 data and writes it to the process stdin.
func (h *ptyHandle) writeInput(data string) error {
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return fmt.Errorf("base64 decode: %w", err)
	}
	_, err = h.stdin.Write(decoded)
	return err
}

// resize is a no-op on Windows pipe mode (ConPTY resize not yet implemented).
// STUB: implement ConPTY resize via Windows API when ConPTY support is added.
func (h *ptyHandle) resize(cols, rows uint16) error {
	// STUB: ConPTY resize not implemented in pipe mode.
	return nil
}

// stop terminates the process. On Windows there is no SIGTERM; we kill directly.
func (h *ptyHandle) stop(force bool) error {
	return h.cmd.Process.Kill()
}

// pause suspends the process.
// STUB: Windows process suspension requires NtSuspendProcess (undocumented).
func (h *ptyHandle) pause() error {
	// STUB: Windows process suspend not implemented.
	return fmt.Errorf("pause not supported on Windows")
}

// resume resumes a suspended process.
// STUB: Windows process resume requires NtResumeProcess (undocumented).
func (h *ptyHandle) resume() error {
	// STUB: Windows process resume not implemented.
	return fmt.Errorf("resume not supported on Windows")
}

// close cancels the command context and closes stdio pipes.
func (h *ptyHandle) close() {
	h.cancel()
	h.stdin.Close()
}
