package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "Install shell alias so 'claude' uses sessionforge run",
	Long: `Init adds an alias to your shell rc file so that typing 'claude'
automatically invokes 'sessionforge run claude', making every Claude session
visible on the SessionForge dashboard.

Supported shells: bash, zsh. For fish and PowerShell, add the alias manually.`,
	RunE: runInit,
}

func runInit(_ *cobra.Command, _ []string) error {
	if runtime.GOOS == "windows" {
		fmt.Println(`Windows detected. Add this to your PowerShell profile ($PROFILE):

  function claude { sessionforge run claude @args }

Run 'notepad $PROFILE' to open your profile.`)
		return nil
	}

	shell := filepath.Base(os.Getenv("SHELL"))
	var rcFile string
	switch shell {
	case "zsh":
		home, _ := os.UserHomeDir()
		rcFile = filepath.Join(home, ".zshrc")
	case "bash":
		home, _ := os.UserHomeDir()
		rcFile = filepath.Join(home, ".bashrc")
	default:
		return fmt.Errorf("unsupported shell %q — add this alias manually:\n  alias claude='sessionforge run claude'", shell)
	}

	const aliasLine = "alias claude='sessionforge run claude'"
	const marker = "# added by sessionforge init"

	// Check for existing alias — idempotent.
	existing, err := os.ReadFile(rcFile)
	if err == nil && strings.Contains(string(existing), aliasLine) {
		fmt.Printf("Alias already present in %s — nothing to do.\n", rcFile)
		return nil
	}

	f, err := os.OpenFile(rcFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("open %s: %w", rcFile, err)
	}
	defer f.Close()

	_, err = fmt.Fprintf(f, "\n%s\n%s\n", marker, aliasLine)
	if err != nil {
		return fmt.Errorf("write alias: %w", err)
	}

	fmt.Printf("Added alias to %s\nRun: source %s\n", rcFile, rcFile)
	return nil
}
