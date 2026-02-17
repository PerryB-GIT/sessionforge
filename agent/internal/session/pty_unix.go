//go:build !windows

package session

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// ptyHandle wraps the PTY file descriptor and process for Unix systems.
type ptyHandle struct {
	ptmx    *os.File
	cmd     *exec.Cmd
	cancel  context.CancelFunc
}

// allowedCommands is the set of process names the agent may spawn.
var allowedCommands = map[string]bool{
	"claude":     true,
	"bash":       true,
	"zsh":        true,
	"sh":         true,
	"powershell": true,
	"cmd":        true,
}

// resolveCommand returns the absolute path for a given command name.
// Only commands in allowedCommands are permitted.
func resolveCommand(command string) (string, error) {
	// Extract the base binary name for the allow-list check.
	base := command
	if idx := strings.LastIndex(command, "/"); idx >= 0 {
		base = command[idx+1:]
	}
	if !allowedCommands[base] {
		return "", fmt.Errorf("command %q is not allowed; permitted: claude, bash, zsh, sh, powershell, cmd", base)
	}
	return exec.LookPath(command)
}

// spawnPTY starts a new PTY process and wires up output streaming.
// outputFn is called with base64-encoded output chunks; exitFn is called on process exit.
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

	// Build environment: inherit + overlay.
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	// Always set TERM so editors work.
	cmd.Env = append(cmd.Env, "TERM=xterm-256color")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		cancel()
		return nil, 0, fmt.Errorf("pty start: %w", err)
	}

	h := &ptyHandle{
		ptmx:   ptmx,
		cmd:    cmd,
		cancel: cancel,
	}

	// Start output reader goroutine with 16ms debounce (~60fps).
	go readPTYOutput(sessionID, ptmx, outputFn)

	// Wait goroutine: detect exit and call exitFn.
	go func() {
		waitErr := cmd.Wait()
		ptmx.Close()
		code := 0
		if waitErr != nil {
			if exitErr, ok := waitErr.(*exec.ExitError); ok {
				if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
					code = status.ExitStatus()
				} else {
					code = 1
				}
			} else {
				exitFn(sessionID, -1, waitErr)
				return
			}
		}
		exitFn(sessionID, code, nil)
	}()

	return h, cmd.Process.Pid, nil
}

// readPTYOutput reads bytes from the PTY master, batches them with a 16ms debounce,
// base64-encodes the batch, and calls outputFn.
func readPTYOutput(sessionID string, ptmx *os.File, outputFn func(sessionID, data string)) {
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

	// Separate goroutine for blocking reads.
	go func() {
		for {
			n, err := ptmx.Read(buf)
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

// writeInput writes base64-decoded data to the PTY stdin.
func (h *ptyHandle) writeInput(data string) error {
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return fmt.Errorf("base64 decode: %w", err)
	}
	_, err = h.ptmx.Write(decoded)
	return err
}

// resize adjusts the PTY window size.
func (h *ptyHandle) resize(cols, rows uint16) error {
	return pty.Setsize(h.ptmx, &pty.Winsize{
		Cols: cols,
		Rows: rows,
	})
}

// stop sends SIGTERM (or SIGKILL if force=true) to the process.
func (h *ptyHandle) stop(force bool) error {
	if force {
		return h.cmd.Process.Signal(syscall.SIGKILL)
	}
	return h.cmd.Process.Signal(syscall.SIGTERM)
}

// pause sends SIGSTOP to suspend the process.
func (h *ptyHandle) pause() error {
	return h.cmd.Process.Signal(syscall.SIGSTOP)
}

// resume sends SIGCONT to resume a paused process.
func (h *ptyHandle) resume() error {
	return h.cmd.Process.Signal(syscall.SIGCONT)
}

// close releases the PTY and cancels the command context.
func (h *ptyHandle) close() {
	h.cancel()
	h.ptmx.Close()
}
