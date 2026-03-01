package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

var serviceCmd = &cobra.Command{
	Use:   "service",
	Short: "Manage the SessionForge system service",
	Long: `Install, uninstall, start, stop, and restart the SessionForge agent
as an OS service (systemd on Linux, launchd on macOS, Windows Service on Windows).`,
}

var serviceInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Install the agent as a system service",
	RunE:  runServiceInstall,
}

var serviceUninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Remove the system service",
	RunE:  runServiceUninstall,
}

var serviceStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the system service",
	RunE:  runServiceStart,
}

var serviceStopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop the system service",
	RunE:  runServiceStop,
}

var serviceRestartCmd = &cobra.Command{
	Use:   "restart",
	Short: "Restart the system service",
	RunE:  runServiceRestart,
}

var serviceStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show the system service status",
	RunE:  runServiceStatus,
}

func init() {
	serviceCmd.AddCommand(serviceInstallCmd)
	serviceCmd.AddCommand(serviceUninstallCmd)
	serviceCmd.AddCommand(serviceStartCmd)
	serviceCmd.AddCommand(serviceStopCmd)
	serviceCmd.AddCommand(serviceRestartCmd)
	serviceCmd.AddCommand(serviceStatusCmd)
}

// successMsg prints a styled success line.
func successMsg(action, detail string) {
	fmt.Printf("  %s  %s\n", action, detail)
}

// errorHint prints an error with a hint for the user.
func errorHint(err error, hint string) error {
	return fmt.Errorf("%w\n  Hint: %s", err, hint)
}
