package cli

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/sessionforge/agent/internal/config"
	"github.com/sessionforge/agent/internal/system"
)

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Authenticate with SessionForge",
	Long:  `Manage authentication credentials for the SessionForge agent.`,
}

var (
	loginFlagServer string
	loginFlagKey    string
	loginFlagName   string
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate and save credentials",
	Long: `Login saves your API key and server URL to ~/.sessionforge/config.toml.

Example:
  sessionforge auth login --key sf_live_abc123
  sessionforge auth login --server https://self-hosted.example.com --key sf_live_abc123`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		// Apply flags.
		if loginFlagServer != "" {
			cfg.ServerURL = loginFlagServer
		}
		if loginFlagKey != "" {
			cfg.APIKey = strings.TrimSpace(loginFlagKey)
		}

		// Validate.
		if cfg.APIKey == "" {
			return fmt.Errorf("--key is required (get yours at %s/dashboard/api-keys)", cfg.ServerURL)
		}
		if !strings.HasPrefix(cfg.APIKey, "sf_") {
			fmt.Fprintf(os.Stderr, "Warning: API key does not start with 'sf_'; are you sure it is correct?\n")
		}

		// Generate machine ID if not already set.
		if cfg.MachineID == "" {
			cfg.MachineID = system.GenerateMachineID()
		}

		// Set machine name.
		if loginFlagName != "" {
			cfg.MachineName = loginFlagName
		}
		if cfg.MachineName == "" {
			cfg.MachineName = system.GetHostname()
		}

		if err := config.Save(cfg); err != nil {
			return fmt.Errorf("save config: %w", err)
		}

		path, _ := config.ConfigPath()
		fmt.Println("Authentication saved.")
		fmt.Printf("  Config file:  %s\n", path)
		fmt.Printf("  Machine ID:   %s\n", cfg.MachineID)
		fmt.Printf("  Machine name: %s\n", cfg.MachineName)
		fmt.Printf("  Server URL:   %s\n", cfg.ServerURL)
		fmt.Println()
		fmt.Println("Next steps:")
		fmt.Println("  sessionforge service install   — install as a system service")
		fmt.Println("  sessionforge status            — verify connection")
		return nil
	},
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Remove saved credentials",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		cfg.APIKey = ""
		if err := config.Save(cfg); err != nil {
			return fmt.Errorf("save config: %w", err)
		}

		fmt.Println("Logged out. API key removed from config.")
		return nil
	},
}

func init() {
	loginCmd.Flags().StringVar(&loginFlagServer, "server", config.DefaultServerURL, "SessionForge server URL")
	loginCmd.Flags().StringVar(&loginFlagKey, "key", "", "API key (required)")
	loginCmd.Flags().StringVar(&loginFlagName, "name", "", "Human-readable name for this machine (default: hostname)")
	_ = loginCmd.MarkFlagRequired("key")

	authCmd.AddCommand(loginCmd)
	authCmd.AddCommand(logoutCmd)
}
