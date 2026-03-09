//go:build !windows

package session

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// SetConPTYLogger is a no-op on non-Windows platforms (ConPTY is Windows-only).
func SetConPTYLogger(_ *slog.Logger) {}

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
	if idx := strings.LastIndex(bin, "/"); idx >= 0 {
		base = bin[idx+1:]
	}
	if !allowedCommands[base] {
		return "", nil, fmt.Errorf("command %q is not allowed; permitted: claude, bash, zsh, sh, powershell, cmd", base)
	}
	resolved, err := exec.LookPath(bin)
	return resolved, args, err
}

// spawnPTY starts a new PTY process and wires up output streaming.
// outputFn is called with base64-encoded output chunks; exitFn is called on process exit.
// localOutputFn, if non-nil, is called with raw bytes before base64 encoding — used by
// `sessionforge run` to fan output to the local terminal simultaneously.
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
	binary, args, err := resolveCommand(command)
	if err != nil {
		return nil, 0, fmt.Errorf("resolve command: %w", err)
	}

	cmdCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(cmdCtx, binary, args...)
	cmd.Dir = workdir

	// Build environment: inherit + overlay, stripping vars that must not reach child.
	blocked := map[string]bool{"CLAUDECODE": true}
	for _, kv := range os.Environ() {
		if idx := strings.IndexByte(kv, '='); idx > 0 {
			if !blocked[kv[:idx]] {
				cmd.Env = append(cmd.Env, kv)
			}
		}
	}
	for k, v := range env {
		if !blocked[k] {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
	}
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
	go readPTYOutput(sessionID, ptmx, outputFn, localOutputFn)

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

// maxChunkBytes is the maximum raw bytes per session_output frame.
// Kept small so Cloud Run's HTTP/2 ingress does not buffer frames.
const maxChunkBytes = 512

// readPTYOutput reads bytes from the PTY master, batches them with a 16ms debounce,
// base64-encodes the batch, and calls outputFn. If localOutputFn is non-nil it is
// called with the raw bytes before base64 encoding.
func readPTYOutput(sessionID string, ptmx *os.File, outputFn func(sessionID, data string), localOutputFn func([]byte)) {
	buf := make([]byte, 4096)
	ticker := time.NewTicker(16 * time.Millisecond)
	defer ticker.Stop()

	var pending []byte

	flush := func() {
		for len(pending) > 0 {
			size := len(pending)
			if size > maxChunkBytes {
				size = maxChunkBytes
			}
			chunk := pending[:size]
			pending = pending[size:]
			if localOutputFn != nil {
				localOutputFn(chunk)
			}
			encoded := base64.StdEncoding.EncodeToString(chunk)
			outputFn(sessionID, encoded)
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

// writeInputRaw forwards raw bytes to the PTY stdin without base64 decoding.
// Used by StartWithLocalOutput / WriteInputRaw for local terminal passthrough.
func (h *ptyHandle) writeInputRaw(data []byte) error {
	_, err := h.ptmx.Write(data)
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

// SetClaudePath is a no-op on Unix — path resolution uses the system PATH.
// The Windows implementation stores a pre-resolved path from config.toml
// because the service runs as LocalSystem without access to the user's npm PATH.
func SetClaudePath(_ string) {}
