package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/sessionforge/agent/internal/config"
	"github.com/sessionforge/agent/internal/connection"
)

var (
	runName    string
	runWorkdir string
)

var runCmd = &cobra.Command{
	Use:   "run <command>",
	Short: "Run a command as a cloud-visible session with local terminal passthrough",
	Long: `Run spawns a PTY session that streams I/O to both your local terminal
and the SessionForge cloud dashboard simultaneously.

Examples:
  sessionforge run claude
  sessionforge run claude --name "email-agent"
  sessionforge run bash --workdir ~/project

Press Ctrl+] (ASCII 29) to detach. The session keeps running in the cloud.
Reattach later: sessionforge session attach <session-id>`,
	Args: cobra.MinimumNArgs(1),
	RunE: runRun,
}

func init() {
	runCmd.Flags().StringVar(&runName, "name", "", "Human-readable name shown in the dashboard")
	runCmd.Flags().StringVarP(&runWorkdir, "workdir", "w", ".", "Working directory for the session")
}

func runRun(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.IsConfigured() {
		return fmt.Errorf("not configured — run: sessionforge auth login --key <key>")
	}

	command := strings.Join(args, " ")
	workdir := runWorkdir

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	client, mgr := buildAgentComponents(ctx, cfg)

	go connection.RunHeartbeat(ctx, client, cfg.MachineID, mgr, buildLogger(cfg.LogLevel, cfg.LogFile))
	go client.Run(ctx)

	// Allow WebSocket to register before spawning the session.
	time.Sleep(600 * time.Millisecond)

	// Enable raw mode — must be restored in all exit paths.
	rawState, rawErr := setRawMode()
	if rawErr != nil {
		fmt.Fprintf(os.Stderr, "warning: could not set raw mode: %v\n", rawErr)
	}
	defer restoreMode(rawState)

	// localFn writes raw PTY output bytes to the local terminal.
	localFn := func(raw []byte) {
		os.Stdout.Write(raw)
	}

	sessionID, err := mgr.StartWithLocalOutput("cli-run", "", command, workdir, nil, localFn)
	if err != nil {
		restoreMode(rawState)
		return fmt.Errorf("start session: %w", err)
	}

	if runName != "" {
		fmt.Fprintf(os.Stderr, "Session started: %s  name: %s\n", sessionID, runName)
	} else {
		fmt.Fprintf(os.Stderr, "Session started: %s\n", sessionID)
	}
	fmt.Fprintln(os.Stderr, "Press Ctrl+] to detach.")

	// Stdin passthrough loop: read local stdin, forward to PTY.
	// Ctrl+] (byte 29) breaks the loop and detaches.
	detached := make(chan struct{})
	go func() {
		defer close(detached)
		buf := make([]byte, 256)
		for {
			n, err := os.Stdin.Read(buf)
			if err != nil {
				return
			}
			if n > 0 && buf[0] == 29 { // Ctrl+]
				return
			}
			if n > 0 {
				_ = mgr.WriteInputRaw(sessionID, buf[:n])
			}
		}
	}()

	// Block until detach, process exit, or OS signal.
	select {
	case <-detached:
		restoreMode(rawState)
		fmt.Fprintf(os.Stderr, "\nDetached. Session ID: %s\nReattach: sessionforge session attach %s\n",
			sessionID, sessionID)
	case <-ctx.Done():
		restoreMode(rawState)
	}

	return nil
}
