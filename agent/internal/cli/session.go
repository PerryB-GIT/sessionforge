package cli

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/sessionforge/agent/internal/config"
	"github.com/sessionforge/agent/internal/connection"
	"github.com/sessionforge/agent/internal/session"
)

// jsonUnmarshal is an alias so test files can stub it if needed.
var jsonUnmarshal = json.Unmarshal

var sessionCmd = &cobra.Command{
	Use:   "session",
	Short: "Manage terminal sessions",
	Long:  `Commands to list, start, stop, and attach to terminal sessions.`,
}

var sessionListCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls"},
	Short:   "List active sessions on this machine",
	RunE:    runSessionList,
}

var (
	sessionStartCommand string
	sessionStartWorkdir string
)

var sessionStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start a new terminal session",
	Long: `Start spawns a new local terminal session and registers it with the cloud.

Examples:
  sessionforge session start
  sessionforge session start --command bash --workdir /home/user/project`,
	RunE: runSessionStart,
}

var sessionStopCmd = &cobra.Command{
	Use:   "stop SESSION_ID",
	Short: "Stop a running session",
	Args:  cobra.ExactArgs(1),
	RunE:  runSessionStop,
}

var sessionAttachCmd = &cobra.Command{
	Use:   "attach SESSION_ID",
	Short: "Attach an interactive terminal to a running session",
	Long: `Attach your terminal to an existing session. Keystrokes are forwarded
to the remote session; output streams back to your terminal.

Press Ctrl+] (ASCII 29) to detach without terminating the session.`,
	Args: cobra.ExactArgs(1),
	RunE: runSessionAttach,
}

func init() {
	sessionStartCmd.Flags().StringVarP(&sessionStartCommand, "command", "c", "claude",
		"Command to run (claude, bash, zsh, sh, powershell, cmd)")
	sessionStartCmd.Flags().StringVarP(&sessionStartWorkdir, "workdir", "w", ".",
		"Working directory for the session")

	sessionCmd.AddCommand(sessionListCmd)
	sessionCmd.AddCommand(sessionStartCmd)
	sessionCmd.AddCommand(sessionStopCmd)
	sessionCmd.AddCommand(sessionAttachCmd)
}

// buildAgentComponents creates a connected client + manager pair, suitable for
// short-lived CLI commands.  The caller is responsible for cancelling ctx.
func buildAgentComponents(ctx context.Context, cfg *config.Config) (*connection.Client, *session.Manager) {
	var dispatch func(msg connection.CloudMessage)
	dispatchWrapper := func(msg connection.CloudMessage) {
		if dispatch != nil {
			dispatch(msg)
		}
	}

	logger := buildLogger(cfg.LogLevel)
	client := connection.NewClient(cfg, version, dispatchWrapper, logger)
	mgr := session.NewManager(ctx, client, logger)
	handler := connection.NewHandler(mgr, client, logger)
	dispatch = handler.Handle

	return client, mgr
}

func runSessionList(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.IsConfigured() {
		return fmt.Errorf("not configured — run: sessionforge auth login --key <key>")
	}

	// Build a local manager to enumerate sessions (no cloud connection needed).
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_, mgr := buildAgentComponents(ctx, cfg)
	sessions := mgr.GetAll()

	if len(sessions) == 0 {
		fmt.Println("No active sessions.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "SESSION ID\tPID\tCOMMAND\tWORKDIR\tSTARTED AT")
	for _, s := range sessions {
		fmt.Fprintf(w, "%s\t%d\t%s\t%s\t%s\n",
			s.ID,
			s.PID,
			s.ProcessName,
			s.Workdir,
			s.StartedAt.Format("2006-01-02 15:04:05"),
		)
	}
	return w.Flush()
}

func runSessionStart(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.IsConfigured() {
		return fmt.Errorf("not configured — run: sessionforge auth login --key <key>")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	client, mgr := buildAgentComponents(ctx, cfg)

	go connection.RunHeartbeat(ctx, client, cfg.MachineID, mgr, buildLogger(cfg.LogLevel))
	go client.Run(ctx)

	// Give the WebSocket connection time to register.
	time.Sleep(600 * time.Millisecond)

	sessionID, err := mgr.Start("cli-start", sessionStartCommand, sessionStartWorkdir, nil)
	if err != nil {
		return fmt.Errorf("start session: %w", err)
	}

	fmt.Printf("Session started: %s\n", sessionID)
	fmt.Printf("Command: %s  |  Workdir: %s\n", sessionStartCommand, sessionStartWorkdir)
	fmt.Println("Press Ctrl+C to stop.")

	<-ctx.Done()
	mgr.StopAll()
	return nil
}

func runSessionStop(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.IsConfigured() {
		return fmt.Errorf("not configured — run: sessionforge auth login --key <key>")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, mgr := buildAgentComponents(ctx, cfg)
	go client.Run(ctx)
	time.Sleep(400 * time.Millisecond)

	sessionID := args[0]
	if err := mgr.Stop(sessionID, false); err != nil {
		return fmt.Errorf("stop session %s: %w", sessionID, err)
	}

	fmt.Printf("Session %s stopped.\n", sessionID)
	return nil
}

// runSessionAttach bridges the local terminal to an existing session via the cloud WebSocket.
// Input typed locally is base64-encoded and sent as session_input messages.
// Output from the session arrives as session_output messages and is written to stdout.
func runSessionAttach(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.IsConfigured() {
		return fmt.Errorf("not configured — run: sessionforge auth login --key <key>")
	}

	sessionID := args[0]
	fmt.Printf("Attaching to session %s (Ctrl+] to detach)...\n\n", sessionID)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// Intercept session_output for our session and write decoded bytes to stdout.
	var client *connection.Client
	var mgr *session.Manager
	var dispatch func(msg connection.CloudMessage)

	dispatchWrapper := func(msg connection.CloudMessage) {
		if msg.Type == "session_output" {
			// We handle output directly here; other messages go to the handler.
			handleAttachOutput(sessionID, msg)
			return
		}
		if dispatch != nil {
			dispatch(msg)
		}
	}

	logger := buildLogger(cfg.LogLevel)
	client = connection.NewClient(cfg, version, dispatchWrapper, logger)
	mgr = session.NewManager(ctx, client, logger)
	h := connection.NewHandler(mgr, client, logger)
	dispatch = h.Handle

	go client.Run(ctx)
	time.Sleep(400 * time.Millisecond)

	// Read stdin and forward; Ctrl+] (byte 29) = detach.
	buf := make([]byte, 256)
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		n, err := os.Stdin.Read(buf)
		if err != nil {
			return nil
		}
		if n > 0 && buf[0] == 29 { // Ctrl+]
			fmt.Println("\nDetached.")
			return nil
		}

		encoded := base64.StdEncoding.EncodeToString(buf[:n])
		_ = client.SendJSON(map[string]string{
			"type":      "session_input",
			"sessionId": sessionID,
			"data":      encoded,
		})
	}
}

// handleAttachOutput decodes a session_output message and writes it to stdout.
func handleAttachOutput(sessionID string, msg connection.CloudMessage) {
	var m struct {
		SessionID string `json:"sessionId"`
		Data      string `json:"data"`
	}
	if err := jsonUnmarshal(msg.Raw, &m); err != nil {
		return
	}
	if m.SessionID != sessionID {
		return
	}
	decoded, err := base64.StdEncoding.DecodeString(m.Data)
	if err != nil {
		return
	}
	os.Stdout.Write(decoded)
}
