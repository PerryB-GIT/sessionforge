// Package cli implements the SessionForge agent command-line interface.
package cli

import (
	"context"
	"fmt"
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

	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(authCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(sessionCmd)
	rootCmd.AddCommand(serviceCmd)
	rootCmd.AddCommand(updateCmd)
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

// runDaemon is the main agent event loop.
// It connects to the SessionForge cloud over WebSocket, registers the machine,
// sends periodic heartbeats, and dispatches cloud commands to the session manager.
func runDaemon(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	if !cfg.IsConfigured() {
		fmt.Fprintln(os.Stderr, "Error: agent is not configured.")
		fmt.Fprintln(os.Stderr, "Run: sessionforge auth login --key <your-api-key>")
		os.Exit(1)
	}

	// CLI flag overrides config file log level.
	logLevel := cfg.LogLevel
	if flagLogLevel != "" {
		logLevel = flagLogLevel
	}

	logger := buildLogger(logLevel)
	logger.Info("SessionForge Agent starting",
		"version", version,
		"machineId", cfg.MachineID,
		"machineName", cfg.MachineName,
		"server", cfg.ServerURL,
		"os", system.GetOS(),
	)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

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
	handler := connection.NewHandler(mgr, client, logger)

	// Wire up dispatch to the fully-constructed handler.
	dispatch = handler.Handle

	// Start heartbeat (sends metrics every 30s).
	go connection.RunHeartbeat(ctx, client, cfg.MachineID, mgr, logger)

	// Start the WebSocket client (blocks with auto-reconnect until ctx cancelled).
	go client.Run(ctx)

	// Block until OS signal.
	<-ctx.Done()

	logger.Info("shutdown signal received — stopping all sessions")
	mgr.StopAll()
	client.Wait()
	logger.Info("SessionForge Agent stopped")
	return nil
}

// buildLogger creates a structured slog logger at the requested level.
func buildLogger(level string) *slog.Logger {
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
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: l}))
}
