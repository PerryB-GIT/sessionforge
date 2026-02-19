//go:build windows

package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"
)

const serviceName = "SessionForgeAgent"
const serviceDisplayName = "SessionForge Agent"
const serviceDescription = "Connects this machine to the SessionForge cloud for remote session management."

// runServiceInstall registers a Windows Service using sc.exe.
// STUB: Full Windows Service integration (e.g. kardianos/service) can be added
// for production; sc.exe covers the basic install use-case.
func runServiceInstall(cmd *cobra.Command, args []string) error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	execPath, _ = filepath.EvalSymlinks(execPath)

	// STUB: Windows service registration via sc.exe.
	// For full SCM integration with Start/Stop handlers, use golang.org/x/sys/windows/svc
	// or github.com/kardianos/service.
	scArgs := []string{
		"create", serviceName,
		"binPath=", execPath,
		"DisplayName=", serviceDisplayName,
		"start=", "auto",
		"obj=", "LocalSystem",
	}
	out, err := exec.Command("sc.exe", scArgs...).CombinedOutput()
	if err != nil {
		return errorHint(
			fmt.Errorf("sc create: %w\n%s", err, out),
			"Run this command as Administrator",
		)
	}

	// Set description.
	descArgs := []string{"description", serviceName, serviceDescription}
	_ = exec.Command("sc.exe", descArgs...).Run()

	successMsg("Installed", "Windows Service: "+serviceName)
	fmt.Println("Run: sessionforge service start")
	return nil
}

func runServiceUninstall(cmd *cobra.Command, args []string) error {
	_ = exec.Command("sc.exe", "stop", serviceName).Run()
	out, err := exec.Command("sc.exe", "delete", serviceName).CombinedOutput()
	if err != nil {
		return errorHint(
			fmt.Errorf("sc delete: %w\n%s", err, out),
			"Run this command as Administrator",
		)
	}
	fmt.Println("Service uninstalled.")
	return nil
}

func runServiceStart(cmd *cobra.Command, args []string) error {
	out, err := exec.Command("sc.exe", "start", serviceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sc start: %w\n%s", err, out)
	}
	fmt.Println("Service started.")
	return nil
}

func runServiceStop(cmd *cobra.Command, args []string) error {
	out, err := exec.Command("sc.exe", "stop", serviceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("sc stop: %w\n%s", err, out)
	}
	fmt.Println("Service stopped.")
	return nil
}

func runServiceRestart(cmd *cobra.Command, args []string) error {
	_ = runServiceStop(cmd, args)
	return runServiceStart(cmd, args)
}

func runServiceStatus(cmd *cobra.Command, args []string) error {
	out, _ := exec.Command("sc.exe", "query", serviceName).CombinedOutput()
	fmt.Print(string(out))
	return nil
}
