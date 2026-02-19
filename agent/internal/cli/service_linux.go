//go:build linux

package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"text/template"

	"github.com/spf13/cobra"
)

const systemdUnitTemplate = `[Unit]
Description=SessionForge Agent
Documentation=https://sessionforge.dev/docs/agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={{.ExecPath}}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sessionforge
WorkingDirectory={{.WorkDir}}

[Install]
WantedBy=multi-user.target
`

const unitFile = "/etc/systemd/system/sessionforge.service"

func runServiceInstall(cmd *cobra.Command, args []string) error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	execPath, _ = filepath.EvalSymlinks(execPath)
	workDir, _ := os.UserHomeDir()

	tmpl, _ := template.New("unit").Parse(systemdUnitTemplate)
	f, err := os.OpenFile(unitFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return errorHint(err, "Try: sudo sessionforge service install")
	}
	defer f.Close()

	if err := tmpl.Execute(f, map[string]string{
		"ExecPath": execPath,
		"WorkDir":  workDir,
	}); err != nil {
		return fmt.Errorf("write unit file: %w", err)
	}

	if err := exec.Command("systemctl", "daemon-reload").Run(); err != nil {
		return fmt.Errorf("systemctl daemon-reload: %w", err)
	}
	if err := exec.Command("systemctl", "enable", "sessionforge").Run(); err != nil {
		return fmt.Errorf("systemctl enable: %w", err)
	}

	successMsg("Installed", unitFile)
	fmt.Println("Run: sessionforge service start")
	return nil
}

func runServiceUninstall(cmd *cobra.Command, args []string) error {
	_ = exec.Command("systemctl", "stop", "sessionforge").Run()
	_ = exec.Command("systemctl", "disable", "sessionforge").Run()
	if err := os.Remove(unitFile); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove unit file: %w", err)
	}
	_ = exec.Command("systemctl", "daemon-reload").Run()
	fmt.Println("Service uninstalled.")
	return nil
}

func runServiceStart(cmd *cobra.Command, args []string) error {
	if out, err := exec.Command("systemctl", "start", "sessionforge").CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl start: %w\n%s", err, out)
	}
	fmt.Println("Service started.")
	return nil
}

func runServiceStop(cmd *cobra.Command, args []string) error {
	if out, err := exec.Command("systemctl", "stop", "sessionforge").CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl stop: %w\n%s", err, out)
	}
	fmt.Println("Service stopped.")
	return nil
}

func runServiceRestart(cmd *cobra.Command, args []string) error {
	if out, err := exec.Command("systemctl", "restart", "sessionforge").CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl restart: %w\n%s", err, out)
	}
	fmt.Println("Service restarted.")
	return nil
}

func runServiceStatus(cmd *cobra.Command, args []string) error {
	out, _ := exec.Command("systemctl", "status", "sessionforge", "--no-pager").CombinedOutput()
	fmt.Print(string(out))
	return nil
}
