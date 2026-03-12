// Package cli implements the SessionForge agent command-line interface.
package cli

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/sessionforge/agent/internal/config"
	"github.com/sessionforge/agent/internal/connection"
	"github.com/sessionforge/agent/internal/session"
	"github.com/sessionforge/agent/internal/system"
)

var (
	version   string
	buildDate string
	gitCommit string
)

// SetVersion is called from main() to inject build-time version info via ldflags.
func SetVersion(v, d, c string) {
	version = v
	buildDate = d
	gitCommit = c
}

// Execute runs the root Cobra command.
func Execute() error {
	return rootCmd.Execute()
}

var flagLogLevel string
var flagConfigDir string

// SetConfigDir allows the Windows service init path to set the config directory
// before Cobra parses flags (service mode bypasses Cobra entirely).
func SetConfigDir(dir string) {
	flagConfigDir = dir
}

var rootCmd = &cobra.Command{
	Use:   "sessionforge",
	Short: "SessionForge Agent — Remote AI Session Manager",
	Long: `SessionForge Agent connects your machine to the SessionForge cloud,
allowing you to manage Claude Code and other terminal sessions from anywhere.

Get started:
  1. sessionforge auth login --key sf_live_xxxxx
  2. sessionforge service install
  3. sessionforge status

Running 'sessionforge' without a subcommand starts the agent daemon.`,
	// Running bare 'sessionforge' starts the agent daemon.
	RunE: runDaemon,
}

func init() {
	rootCmd.PersistentFlags().StringVar(&flagLogLevel, "log-level", "",
		"Override log level (debug, info, warn, error)")
	rootCmd.PersistentFlags().StringVar(&flagConfigDir, "config-dir", "",
		"Override config directory (default: ~/.sessionforge)")

	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(authCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(sessionCmd)
	rootCmd.AddCommand(serviceCmd)
	rootCmd.AddCommand(updateCmd)
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(runCmd)
}

// versionCmd prints build-time information.
var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("SessionForge Agent v%s\n", version)
		fmt.Printf("Build Date: %s\n", buildDate)
		fmt.Printf("Git Commit: %s\n", gitCommit)
		fmt.Printf("Platform:   %s / %s\n", system.GetOS(), system.GetHostname())
	},
}

// runDaemon is the Cobra entry point for the bare `sessionforge` command.
// It creates an OS-signal context then delegates to runDaemonWithContext.
func runDaemon(cmd *cobra.Command, args []string) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return runDaemonWithContext(ctx)
}

// runDaemonWithContext is the main agent event loop.
// It accepts an external context so it can be driven by either OS signals
// (interactive) or the Windows SCM stop handler (service mode).
func runDaemonWithContext(ctx context.Context) error {
	cfg, err := config.LoadFrom(flagConfigDir)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if !cfg.IsConfigured() {
		return fmt.Errorf("agent is not configured — run: sessionforge auth login --key <your-api-key>")
	}

	// CLI flag overrides config file log level.
	logLevel := cfg.LogLevel
	if flagLogLevel != "" {
		logLevel = flagLogLevel
	}

	logger := buildLogger(logLevel, cfg.LogFile)
	logger.Info("SessionForge Agent starting",
		"version", version,
		"machineId", cfg.MachineID,
		"machineName", cfg.MachineName,
		"server", cfg.ServerURL,
		"os", system.GetOS(),
	)

	// We build handler, client, and manager with mutual references via a
	// dispatch wrapper that is set up after all three are constructed.
	var dispatch func(msg connection.CloudMessage)

	// dispatchWrapper calls dispatch after it's been assigned.
	dispatchWrapper := func(msg connection.CloudMessage) {
		if dispatch != nil {
			dispatch(msg)
		}
	}

	client := connection.NewClient(cfg, version, dispatchWrapper, logger)
	mgr := session.NewManager(ctx, client, logger)

	// Run the ConPTY probe eagerly at startup so it completes before the first
	// session request arrives. Without this the probe blocks the session goroutine
	// for up to 3 seconds and causes session_started to be sent with pid=0.
	go session.WarmUpSpawnTier()

	// If install stored a resolved claude path in config, prime the session
	// package so the service (running as LocalSystem) can find claude without
	// needing the user's npm directories in the system PATH.
	if cfg.ClaudePath != "" {
		mgr.SetClaudePath(cfg.ClaudePath)
		logger.Info("using stored claude path from config", "claudePath", cfg.ClaudePath)
	}

	// Inject the user's Claude config directory into every spawned session so
	// Claude Code picks up skills, memory, MCP connections, and CLAUDE.md.
	if cfg.ClaudeConfigDir != "" {
		mgr.SetClaudeConfigDir(cfg.ClaudeConfigDir)
		logger.Info("using claude config dir from config", "claudeConfigDir", cfg.ClaudeConfigDir)
	}

	handler := connection.NewHandler(mgr, client, logger)

	// Wire up dispatch to the fully-constructed handler.
	dispatch = handler.Handle

	// Replay session_started for any active sessions after every reconnect so
	// the cloud DB stays in sync even when the WebSocket drops and reconnects.
	client.OnConnect = func() { mgr.ReplayToCloud() }

	// Start heartbeat (sends metrics + discovered processes every 10s).
	go connection.RunHeartbeat(ctx, client, cfg.MachineID, mgr, logger)

	// Start the WebSocket client (blocks with auto-reconnect until ctx cancelled).
	go client.Run(ctx)

	// Block until context is cancelled (OS signal or SCM stop).
	<-ctx.Done()

	logger.Info("shutdown signal received — stopping all sessions")
	mgr.StopAll()
	client.Wait()
	logger.Info("SessionForge Agent stopped")
	return nil
}

// buildLogger creates a structured slog logger at the requested level.
// If logFile is non-empty, output is written to that file (appended) instead of stderr.
func buildLogger(level, logFile string) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}

	var w io.Writer = os.Stderr
	if logFile != "" {
		f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if err == nil {
			// Write to both the file and stderr so interactive runs also print to terminal.
			w = io.MultiWriter(f, os.Stderr)
		}
	}

	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: l}))
}
