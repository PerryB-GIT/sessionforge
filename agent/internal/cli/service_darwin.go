//go:build darwin

package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"text/template"

	"github.com/spf13/cobra"
)

const launchdPlistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.sessionforge.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{.ExecPath}}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{{.LogDir}}/sessionforge.log</string>
    <key>StandardErrorPath</key>
    <string>{{.LogDir}}/sessionforge-error.log</string>
    <key>WorkingDirectory</key>
    <string>{{.WorkDir}}</string>
</dict>
</plist>
`

func plistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", "dev.sessionforge.agent.plist"), nil
}

func runServiceInstall(cmd *cobra.Command, args []string) error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	execPath, _ = filepath.EvalSymlinks(execPath)

	home, _ := os.UserHomeDir()
	logDir := filepath.Join(home, "Library", "Logs", "SessionForge")
	_ = os.MkdirAll(logDir, 0755)

	plist, err := plistPath()
	if err != nil {
		return err
	}
	_ = os.MkdirAll(filepath.Dir(plist), 0755)

	tmpl, _ := template.New("plist").Parse(launchdPlistTemplate)
	f, err := os.OpenFile(plist, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return fmt.Errorf("write plist: %w", err)
	}
	defer f.Close()

	if err := tmpl.Execute(f, map[string]string{
		"ExecPath": execPath,
		"LogDir":   logDir,
		"WorkDir":  home,
	}); err != nil {
		return fmt.Errorf("render plist: %w", err)
	}

	if out, err := exec.Command("launchctl", "load", plist).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl load: %w\n%s", err, out)
	}

	successMsg("Installed", plist)
	fmt.Println("Service will start at login automatically.")
	return nil
}

func runServiceUninstall(cmd *cobra.Command, args []string) error {
	plist, err := plistPath()
	if err != nil {
		return err
	}
	_ = exec.Command("launchctl", "unload", plist).Run()
	if err := os.Remove(plist); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove plist: %w", err)
	}
	fmt.Println("Service uninstalled.")
	return nil
}

func runServiceStart(cmd *cobra.Command, args []string) error {
	if out, err := exec.Command("launchctl", "start", "dev.sessionforge.agent").CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl start: %w\n%s", err, out)
	}
	fmt.Println("Service started.")
	return nil
}

func runServiceStop(cmd *cobra.Command, args []string) error {
	if out, err := exec.Command("launchctl", "stop", "dev.sessionforge.agent").CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl stop: %w\n%s", err, out)
	}
	fmt.Println("Service stopped.")
	return nil
}

func runServiceRestart(cmd *cobra.Command, args []string) error {
	_ = runServiceStop(cmd, args)
	return runServiceStart(cmd, args)
}

func runServiceStatus(cmd *cobra.Command, args []string) error {
	out, _ := exec.Command("launchctl", "list", "dev.sessionforge.agent").CombinedOutput()
	fmt.Print(string(out))
	return nil
}
