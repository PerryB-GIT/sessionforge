//go:build windows

package cli

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/sessionforge/agent/internal/config"
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

	// ── B4: Pre-flight checks ──────────────────────────────────────────────────

	// 1. Confirm the agent binary itself is reachable (sanity check).
	if _, err := os.Stat(execPath); err != nil {
		return fmt.Errorf("agent binary not found at %q: %w", execPath, err)
	}

	// 2. Confirm the config directory is writable.
	userProfile := os.Getenv("USERPROFILE")
	if userProfile == "" {
		return fmt.Errorf("USERPROFILE environment variable is not set; cannot determine config directory")
	}
	configDir := filepath.Join(userProfile, ".sessionforge")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return fmt.Errorf("config directory %q is not writable: %w", configDir, err)
	}
	// Write + delete a probe file to confirm actual write access.
	probe := filepath.Join(configDir, ".write-probe")
	if f, err := os.Create(probe); err != nil {
		return fmt.Errorf("config directory %q is not writable: %w", configDir, err)
	} else {
		f.Close()
		_ = os.Remove(probe)
	}

	// 3. Check whether claude CLI is installed and reachable.
	//    Do this now, while running as the user (with the correct PATH).
	//    The result is stored in config.toml so the service (LocalSystem) can find it.
	claudePath, claudeErr := exec.LookPath("claude")
	if claudeErr != nil {
		// Try npm prefix locations derived from USERPROFILE.
		claudePath = probeNpmDirs(userProfile, "claude")
	}
	if claudePath == "" {
		fmt.Println("WARNING: 'claude' CLI not found in PATH.")
		fmt.Println("  Install it with:  npm install -g @anthropic-ai/claude-code")
		fmt.Println("  Then re-run:      sessionforge service install")
		fmt.Println("  (The service will be installed, but sessions won't start until claude is installed.)")
	} else {
		fmt.Printf("Found claude CLI: %s\n", claudePath)
	}

	// ── B1: Load existing config, store the resolved claude path, and save ────

	cfg, loadErr := config.LoadFrom(configDir)
	if loadErr != nil {
		// Non-fatal: we'll write defaults.
		cfg = config.DefaultConfig()
	}
	if claudePath != "" {
		cfg.ClaudePath = claudePath
	}
	if saveErr := config.SaveFrom(configDir, cfg); saveErr != nil {
		// Non-fatal: log the error but continue — the service can still install.
		fmt.Printf("WARNING: could not save config: %v\n", saveErr)
	} else if claudePath != "" {
		fmt.Printf("Stored claude path in config: %s\n", claudePath)
	}

	// ── SCM: install the service ───────────────────────────────────────────────

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

	// Pass --config-dir so the service (LocalSystem) reads the correct config.toml.
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

// probeNpmDirs searches for a binary in the npm prefix directories under the
// given user profile. Returns the full path on success or "" if not found.
func probeNpmDirs(userProfile, bin string) string {
	for _, dir := range []string{
		filepath.Join(userProfile, "AppData", "Roaming", "npm"),
		filepath.Join(userProfile, "AppData", "Local", "npm"),
	} {
		// Try exec.LookPath (honours PATHEXT).
		if p, err := exec.LookPath(filepath.Join(dir, bin)); err == nil {
			return p
		}
		// Explicitly try the .cmd suffix (npm-installed CLIs on Windows).
		candidate := filepath.Join(dir, bin+".cmd")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
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
