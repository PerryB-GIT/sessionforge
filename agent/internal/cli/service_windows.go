//go:build windows

package cli

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const serviceName = "SessionForgeAgent"
const serviceDisplayName = "SessionForge Agent"
const serviceDescription = "Connects this machine to the SessionForge cloud for remote session management."

// windowsService implements svc.Handler so the Windows SCM can start/stop the daemon.
type windowsService struct{}

// Execute is called by the Windows SCM when the service starts.
// It signals Ready, runs the daemon, and handles Stop/Shutdown control requests.
func (w *windowsService) Execute(args []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	// Signal StartPending immediately so SCM knows we're alive.
	status <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Signal Running BEFORE launching the daemon so the SCM 30s timeout
	// is not consumed by config load or WebSocket dial.
	status <- svc.Status{
		State:   svc.Running,
		Accepts: svc.AcceptStop | svc.AcceptShutdown,
	}

	// Run the daemon in a goroutine so we can listen for SCM control requests.
	done := make(chan error, 1)
	go func() {
		done <- runDaemonCtx(ctx)
	}()

	for {
		select {
		case req := <-requests:
			switch req.Cmd {
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				<-done
				return false, 0
			default:
				// Ignore unhandled control codes.
			}
		case <-done:
			return false, 0
		}
	}
}

// RunAsWindowsService runs the binary under Windows SCM control.
// Called from main() when the process is detected to be running as a service.
func RunAsWindowsService() error {
	return svc.Run(serviceName, &windowsService{})
}

// IsWindowsService reports whether the process was started by the Windows SCM.
func IsWindowsService() (bool, error) {
	return svc.IsWindowsService()
}

// runDaemonCtx is a context-aware wrapper around runDaemon for use by the service handler.
func runDaemonCtx(ctx context.Context) error {
	// runDaemon in root.go blocks on ctx.Done via signal.NotifyContext.
	// We replicate its logic here with the provided context so the SCM
	// stop signal propagates cleanly without depending on OS signals.
	return runDaemonWithContext(ctx)
}

// ── Service management commands (install/uninstall/start/stop/restart/status) ──

func runServiceInstall(cmd *cobra.Command, args []string) error {
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	execPath, _ = filepath.EvalSymlinks(execPath)

	m, err := mgr.Connect()
	if err != nil {
		return errorHint(fmt.Errorf("connect to SCM: %w", err), "Run this command as Administrator")
	}
	defer m.Disconnect()

	// Remove existing service entry if present so reinstall works cleanly.
	if existing, err := m.OpenService(serviceName); err == nil {
		_, _ = existing.Control(svc.Stop)
		_ = existing.Delete()
		existing.Close()
	}

	// Derive the config dir from the installing user's profile so the
	// service (running as LocalSystem) reads the correct config.toml.
	// We pass it as a flag: sessionforge --config-dir C:\Users\Perry\.sessionforge
	userProfile := os.Getenv("USERPROFILE")
	configDir := filepath.Join(userProfile, ".sessionforge")

	s, err := m.CreateService(serviceName, execPath, mgr.Config{
		DisplayName:  serviceDisplayName,
		Description:  serviceDescription,
		StartType:    mgr.StartAutomatic,
		ErrorControl: mgr.ErrorNormal,
	}, "--config-dir", configDir)
	if err != nil {
		return errorHint(fmt.Errorf("create service: %w", err), "Run this command as Administrator")
	}
	defer s.Close()

	successMsg("Installed", "Windows Service: "+serviceName)
	fmt.Println("Run: sessionforge service start")
	return nil
}

func runServiceUninstall(cmd *cobra.Command, args []string) error {
	m, err := mgr.Connect()
	if err != nil {
		return errorHint(fmt.Errorf("connect to SCM: %w", err), "Run this command as Administrator")
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("open service: %w", err)
	}
	defer s.Close()

	_, _ = s.Control(svc.Stop)
	if err := s.Delete(); err != nil {
		return errorHint(fmt.Errorf("delete service: %w", err), "Run this command as Administrator")
	}
	fmt.Println("Service uninstalled.")
	return nil
}

func runServiceStart(cmd *cobra.Command, args []string) error {
	out, err := exec.Command("sc.exe", "start", serviceName).CombinedOutput()
	if err != nil {
		return errorHint(fmt.Errorf("sc start: %w\n%s", err, out), "Run this command as Administrator")
	}
	fmt.Println("Service started.")
	return nil
}

func runServiceStop(cmd *cobra.Command, args []string) error {
	out, err := exec.Command("sc.exe", "stop", serviceName).CombinedOutput()
	if err != nil {
		return errorHint(fmt.Errorf("sc stop: %w\n%s", err, out), "Run this command as Administrator")
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
