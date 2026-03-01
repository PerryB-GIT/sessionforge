package cli

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/sessionforge/agent/internal/config"
	"github.com/sessionforge/agent/internal/system"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show agent status and connection info",
	Long:  `Displays the current configuration, machine info, and connectivity to the SessionForge cloud.`,
	RunE:  runStatus,
}

func runStatus(cmd *cobra.Command, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	divider := strings.Repeat("─", 50)
	fmt.Println("SessionForge Agent Status")
	fmt.Println(divider)

	// Machine info.
	fmt.Printf("%-18s %s\n", "Machine ID:", orNA(cfg.MachineID))
	fmt.Printf("%-18s %s\n", "Machine Name:", orNA(cfg.MachineName))
	fmt.Printf("%-18s %s\n", "Hostname:", system.GetHostname())
	fmt.Printf("%-18s %s\n", "OS:", system.GetOS())
	fmt.Printf("%-18s %s\n", "CPU:", system.GetCPUModel())
	fmt.Printf("%-18s %.1f GB\n", "RAM:", system.GetRAMGB())
	fmt.Println(divider)

	// Config info.
	fmt.Printf("%-18s %s\n", "Server URL:", orNA(cfg.ServerURL))
	fmt.Printf("%-18s %s\n", "API Key:", maskKey(cfg.APIKey))
	fmt.Printf("%-18s %s\n", "Log Level:", orNA(cfg.LogLevel))
	fmt.Println(divider)

	// Connectivity.
	if !cfg.IsConfigured() {
		fmt.Println("Connection:        NOT CONFIGURED")
		fmt.Println()
		fmt.Println("Run: sessionforge auth login --key <your-api-key>")
		return nil
	}

	fmt.Print("Connection:        checking...")
	status, latency := pingServer(cfg)
	fmt.Printf("\r%-18s %s", "Connection:", status)
	if latency > 0 {
		fmt.Printf(" (%.0fms)", float64(latency)/float64(time.Millisecond))
	}
	fmt.Println()
	fmt.Println(divider)
	fmt.Printf("Agent Version:     v%s\n", version)

	return nil
}

// pingServer does a quick HTTP health check against the server.
func pingServer(cfg *config.Config) (string, time.Duration) {
	healthURL := cfg.ServerURL + "/api/health"
	client := &http.Client{Timeout: 5 * time.Second}

	start := time.Now()
	resp, err := client.Get(healthURL)
	elapsed := time.Since(start)

	if err != nil {
		return "UNREACHABLE (" + err.Error() + ")", 0
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent {
		return "CONNECTED", elapsed
	}
	return fmt.Sprintf("ERROR (HTTP %d)", resp.StatusCode), elapsed
}

// orNA returns the value or "not set" if it is empty.
func orNA(s string) string {
	if s == "" {
		return "(not set)"
	}
	return s
}

// maskKey shows only the first 10 characters of an API key.
func maskKey(key string) string {
	if key == "" {
		return "(not set)"
	}
	if len(key) <= 10 {
		return strings.Repeat("*", len(key))
	}
	return key[:10] + strings.Repeat("*", len(key)-10)
}
