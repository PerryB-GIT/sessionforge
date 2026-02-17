package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

var (
	version   string
	buildDate string
	gitCommit string
)

func SetVersion(v, d, c string) {
	version = v
	buildDate = d
	gitCommit = c
}

var rootCmd = &cobra.Command{
	Use:   "sessionforge",
	Short: "SessionForge Agent — Remote AI Session Manager",
	Long: `SessionForge Agent connects your machine to the SessionForge cloud,
allowing you to manage Claude Code sessions from anywhere.`,
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(authCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(sessionCmd)
	rootCmd.AddCommand(serviceCmd)
	rootCmd.AddCommand(updateCmd)
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("SessionForge Agent v%s\n", version)
		fmt.Printf("Build Date: %s\n", buildDate)
		fmt.Printf("Git Commit: %s\n", gitCommit)
	},
}

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Authenticate with SessionForge",
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show agent status and connection info",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("SessionForge Agent Status")
		fmt.Println("─────────────────────────")
		fmt.Println("Status:  Not configured")
		fmt.Println("Run 'sessionforge auth token <your-api-key>' to get started")
	},
}

var sessionCmd = &cobra.Command{
	Use:   "session",
	Short: "Manage Claude Code sessions",
}

var serviceCmd = &cobra.Command{
	Use:   "service",
	Short: "Manage the SessionForge system service",
}

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the SessionForge agent to the latest version",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("Current version: v%s\n", version)
		fmt.Println("Checking for updates...")
		fmt.Println("TODO: implement auto-update")
	},
}
