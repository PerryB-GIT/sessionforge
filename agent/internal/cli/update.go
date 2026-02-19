package cli

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/sessionforge/agent/internal/updater"
)

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the SessionForge agent to the latest version",
	Long: `Checks GitHub Releases for a newer version of the agent.
If one is found, downloads and installs it in-place.

The old binary is renamed to sessionforge.old as a rollback option.`,
	RunE: runUpdate,
}

var updateFlagCheck bool

func init() {
	updateCmd.Flags().BoolVar(&updateFlagCheck, "check", false, "Only check for updates, do not install")
}

func runUpdate(cmd *cobra.Command, args []string) error {
	fmt.Printf("Current version: v%s\n", version)
	fmt.Println("Checking for updates...")

	release, err := updater.CheckLatest()
	if err != nil {
		return fmt.Errorf("check for updates: %w", err)
	}

	latestTag := strings.TrimPrefix(release.TagName, "v")
	currentVersion := strings.TrimPrefix(version, "v")

	fmt.Printf("Latest version:  %s\n", release.TagName)

	if !updater.IsNewer(currentVersion, latestTag) {
		fmt.Println("You are already running the latest version.")
		return nil
	}

	fmt.Printf("New version available: %s -> %s\n", version, release.TagName)

	if updateFlagCheck {
		fmt.Println("Run 'sessionforge update' to install.")
		return nil
	}

	fmt.Printf("Downloading and installing %s...\n", release.TagName)
	if err := updater.DownloadAndInstall(release); err != nil {
		return fmt.Errorf("install update: %w", err)
	}

	fmt.Printf("Successfully updated to %s. Restart the agent to apply.\n", release.TagName)
	return nil
}
