// agent/internal/session/tier_windows.go
//go:build windows

package session

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows"
)

// ── Package-level tier state ────────────────────────────────────────────────

// tierOnce runs the full detection cascade exactly once: WSL → Git Bash → ConPTY probe → pipes.
var (
	tierOnce  sync.Once
	spawnTier string // "wsl", "gitbash", "conpty", or "pipes"

	detectedWSLDistro   string
	detectedGitBashPath string
)

// WarmUpSpawnTier runs the tier detection cascade in the background.
// Called as `go session.WarmUpSpawnTier()` in root.go at daemon startup.
func WarmUpSpawnTier() {
	tierOnce.Do(runTierDetection)
}

// ensureTierDetected is called by spawnPTY to guarantee detection has run.
func ensureTierDetected() {
	tierOnce.Do(runTierDetection)
}

// detectSpawnTier runs detection and returns the selected tier string.
// Used by tests to inspect the result without relying on package state.
func detectSpawnTier() string {
	ensureTierDetected()
	return spawnTier
}

// runTierDetection is the core cascade. Called exactly once via tierOnce.
func runTierDetection() {
	logger := conPTYWorkingLogger

	// Step 1: Try WSL
	if distro, ok := detectWSL(); ok {
		spawnTier = "wsl"
		detectedWSLDistro = distro
		if logger != nil {
			logger.Info("spawn tier detection complete",
				"selected", "wsl",
				"distro", distro,
				"wsl", "available",
				"gitbash", "skipped",
				"conpty", "skipped",
			)
		}
		if managerDebugLog != nil {
			managerDebugLog.Info("tier_detection", "Tier selected: wsl", map[string]any{
				"tier":   "wsl",
				"distro": distro,
			})
		}
		return
	}

	// Step 2: Try Git Bash
	if bashPath, ok := detectGitBash(); ok {
		spawnTier = "gitbash"
		detectedGitBashPath = bashPath
		if logger != nil {
			logger.Info("spawn tier detection complete",
				"selected", "gitbash",
				"wsl", "unavailable",
				"gitbash", "ready",
				"conpty", "skipped",
			)
		}
		if managerDebugLog != nil {
			managerDebugLog.Info("tier_detection", "Tier selected: gitbash", map[string]any{
				"tier":     "gitbash",
				"bashPath": bashPath,
			})
		}
		return
	}

	// Step 3: Skip ConPTY probe if running as LocalSystem — CreatePseudoConsole
	// hangs indefinitely in Session 0 (service context). Use pipes tier directly.
	if isLocalSystem() {
		conPTYWorking = false
		spawnTier = "pipes"
		conPTYWorkingOnce.Do(func() {})
		if logger != nil {
			logger.Info("spawn tier detection complete",
				"selected", "pipes",
				"reason", "LocalSystem: ConPTY unavailable in Session 0",
				"wsl", "unavailable",
				"gitbash", "unavailable",
				"conpty", "skipped",
			)
		}
		if managerDebugLog != nil {
			managerDebugLog.Info("tier_detection", "Tier selected: pipes (LocalSystem)", map[string]any{
				"tier":   "pipes",
				"reason": "LocalSystem: ConPTY unavailable in Session 0",
			})
		}
		return
	}

	// Step 4: ConPTY probe
	conPTYWorking = probeConPTY()
	// Mark conPTYWorkingOnce as done so spawnPTY does not re-probe.
	conPTYWorkingOnce.Do(func() {})
	if conPTYWorking {
		spawnTier = "conpty"
	} else {
		spawnTier = "pipes"
	}

	if logger != nil {
		tier := spawnTier
		logger.Info("spawn tier detection complete",
			"selected", tier,
			"wsl", "unavailable",
			"gitbash", "unavailable",
			"conpty", fmt.Sprintf("%v", conPTYWorking),
		)
	}
	if managerDebugLog != nil {
		managerDebugLog.Info("tier_detection", "Tier selected: "+spawnTier, map[string]any{
			"tier":          spawnTier,
			"conPTYWorking": conPTYWorking,
		})
	}
}

// ── WSL Detection ───────────────────────────────────────────────────────────

func detectWSL() (string, bool) {
	logger := conPTYWorkingLogger

	// wsl --list fails when running as LocalSystem (WSL is per-user).
	// Instead, probe known distro names directly via wsl -d <name>.
	// This works even as LocalSystem because wsl.exe resolves the user context
	// from the Windows session, not the service account.
	candidates := wslDistrocandidates()
	for _, distro := range candidates {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		claudeOut, err := exec.CommandContext(ctx, "wsl", "-d", distro, "--", "which", "claude").CombinedOutput()
		cancel()
		if err != nil {
			if logger != nil {
				logger.Debug("WSL detection: claude not found in distro", "distro", distro, "err", err)
			}
			continue
		}
		claudePath := strings.TrimSpace(string(claudeOut))
		if claudePath == "" {
			continue
		}
		// Skip if claude is only available via Windows interop (path starts with /mnt/).
		// Windows binaries can't use Linux PTYs, so script -qfc won't work.
		if strings.HasPrefix(claudePath, "/mnt/") {
			if logger != nil {
				logger.Debug("WSL detection: claude is Windows interop binary, skipping", "distro", distro, "claudePath", claudePath)
			}
			continue
		}
		if logger != nil {
			logger.Info("WSL detection: claude found", "distro", distro, "claudePath", claudePath)
		}
		if managerDebugLog != nil {
			managerDebugLog.Info("tier_detection", "WSL: claude found", map[string]any{
				"distro":     distro,
				"claudePath": claudePath,
			})
		}
		return distro, true
	}
	if managerDebugLog != nil {
		managerDebugLog.Debug("tier_detection", "WSL: claude not found in any distro", nil)
	}
	return "", false
}

// wslDistrocandidates returns distro names to probe, in preference order.
// Reads from the user registry first; falls back to common names.
func wslDistrocandidates() []string {
	// Try reading from HKCU registry (works when running as the logged-in user).
	names := wslDistrosFromRegistry()
	if len(names) > 0 {
		return names
	}
	// Fallback: probe common distro names.
	return []string{"Ubuntu", "Ubuntu-22.04", "Ubuntu-20.04", "Debian", "kali-linux"}
}

// wslDistrosFromRegistry reads installed WSL distro names from the current
// user's registry hive. Returns nil if the key is inaccessible (e.g. LocalSystem).
func wslDistrosFromRegistry() []string {
	key, err := registry.OpenKey(registry.CURRENT_USER,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss`,
		registry.READ)
	if err != nil {
		return nil
	}
	defer key.Close()

	subkeys, err := key.ReadSubKeyNames(-1)
	if err != nil {
		return nil
	}

	var names []string
	for _, sub := range subkeys {
		sk, err := registry.OpenKey(key, sub, registry.READ)
		if err != nil {
			continue
		}
		name, _, err := sk.GetStringValue("DistributionName")
		sk.Close()
		if err == nil && name != "" {
			names = append(names, name)
		}
	}
	return names
}

// ── Git Bash Detection ──────────────────────────────────────────────────────

func detectGitBash() (string, bool) {
	logger := conPTYWorkingLogger

	bashPath := gitBashPath()
	if _, err := os.Stat(bashPath); err != nil {
		if logger != nil {
			logger.Debug("Git Bash detection: bash.exe not found", "path", bashPath, "err", err)
		}
		if managerDebugLog != nil {
			managerDebugLog.Debug("tier_detection", "Git Bash: bash.exe not found", map[string]any{
				"path": bashPath,
			})
		}
		return "", false
	}

	// Running as LocalSystem means `which claude` won't find user npm packages.
	// Check known per-user npm locations directly before falling back to PATH.
	claudeFound := false
	knownPaths := []string{
		`C:\Users\Jakeb\AppData\Roaming\npm\claude`,
		`C:\Users\Jakeb\AppData\Roaming\npm\claude.cmd`,
		`C:\Users\Perry\AppData\Roaming\npm\claude`,
		`C:\Users\Perry\AppData\Roaming\npm\claude.cmd`,
	}
	for _, p := range knownPaths {
		if _, err := os.Stat(p); err == nil {
			claudeFound = true
			if logger != nil {
				logger.Info("Git Bash detection: claude found via known path", "bashPath", bashPath, "claudePath", p)
			}
			break
		}
	}

	if !claudeFound {
		// Fall back to which claude in login shell.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, bashPath, "-c", "which claude").CombinedOutput()
		if err != nil {
			if logger != nil {
				logger.Debug("Git Bash detection: claude not found", "err", err, "output", string(out))
			}
			return "", false
		}
		if logger != nil {
			logger.Info("Git Bash detection: claude found via PATH", "bashPath", bashPath, "claudePath", strings.TrimSpace(string(out)))
		}
		if managerDebugLog != nil {
			managerDebugLog.Info("tier_detection", "Git Bash: claude found via PATH", map[string]any{
				"bashPath":   bashPath,
				"claudePath": strings.TrimSpace(string(out)),
			})
		}
	}

	return bashPath, true
}

func ensureClaudeInGitBash(bashPath string) bool {
	logger := conPTYWorkingLogger

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, bashPath, "-l", "-c", "npm install -g @anthropic-ai/claude-code")
	out, err := cmd.CombinedOutput()
	if err != nil {
		if logger != nil {
			logger.Warn("Git Bash: npm install claude-code failed", "err", err, "output", string(out))
		}
		return false
	}

	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()
	if _, err := exec.CommandContext(ctx2, bashPath, "-l", "-c", "which claude").CombinedOutput(); err != nil {
		if logger != nil {
			logger.Warn("Git Bash: claude not found after npm install", "err", err)
		}
		return false
	}

	if logger != nil {
		logger.Info("Git Bash: claude installed successfully via npm")
	}
	return true
}

func gitBashPath() string {
	// Check bundled gitbash first (installer may bundle it alongside the agent).
	exe, err := os.Executable()
	if err == nil {
		bundled := filepath.Join(filepath.Dir(exe), "gitbash", "bin", "bash.exe")
		if _, err := os.Stat(bundled); err == nil {
			return bundled
		}
	}
	// Fall back to system Git for Windows installations.
	candidates := []string{
		`C:\Program Files\Git\bin\bash.exe`,
		`C:\Program Files (x86)\Git\bin\bash.exe`,
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	// Return bundled path as sentinel so detectGitBash logs the right path.
	if err == nil {
		return filepath.Join(filepath.Dir(exe), "gitbash", "bin", "bash.exe")
	}
	return ""
}

// resolveClaudePath returns the absolute Windows path to the claude executable,
// checking known per-user npm locations. Returns "" if not found.
func resolveClaudePath() string {
	candidates := []string{
		`C:\Users\Jakeb\AppData\Roaming\npm\claude`,
		`C:\Users\Jakeb\AppData\Roaming\npm\claude.cmd`,
		`C:\Users\Perry\AppData\Roaming\npm\claude`,
		`C:\Users\Perry\AppData\Roaming\npm\claude.cmd`,
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// resolveClaudeCliJS returns the path to the Claude Code cli.js entry point.
// bash cannot execute .cmd files, so we invoke node + cli.js directly.
func resolveClaudeCliJS() string {
	candidates := []string{
		`C:\Users\Jakeb\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js`,
		`C:\Users\Perry\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js`,
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// resolveNodePath returns the absolute path to node.exe, preferring 8.3
// short paths so bash -c commands don't need quoting for spaces.
func resolveNodePath() string {
	// 8.3 short paths first — no spaces, no quoting required in bash -c.
	candidates := []string{
		`C:\PROGRA~1\nodejs\node.exe`,
		`C:\PROGRA~2\nodejs\node.exe`,
		`C:\Program Files\nodejs\node.exe`,
		`C:\Program Files (x86)\nodejs\node.exe`,
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return "node" // fallback — hope it's on PATH
}

// windowsPathToBash converts a Windows path like "C:\Users\Jakeb\foo.cmd"
// to a Git Bash compatible path like "/c/Users/Jakeb/foo.cmd".
func windowsPathToBash(p string) string {
	p = strings.ReplaceAll(p, `\`, "/")
	if len(p) >= 2 && p[1] == ':' {
		drive := strings.ToLower(string(p[0]))
		return "/" + drive + p[2:]
	}
	return p
}

// windowsToWSLPath converts a Windows path like "C:\Users\Jakeb\project"
// to a WSL path. The mount prefix depends on the distro:
// - Standard Ubuntu/Debian: /mnt/c/...
// - Docker Desktop WSL: /mnt/host/c/...
func windowsToWSLPath(winPath string) (string, bool) {
	if strings.HasPrefix(winPath, `\\`) {
		return "", false
	}

	p := strings.ReplaceAll(winPath, `\`, "/")

	if len(p) >= 2 && p[1] == ':' {
		drive := strings.ToLower(string(p[0]))
		rest := p[2:]
		prefix := wslMountPrefix()
		return prefix + drive + rest, true
	}

	return p, true
}

// wslMountPrefix returns the Windows drive mount prefix for the detected WSL distro.
func wslMountPrefix() string {
	if strings.EqualFold(detectedWSLDistro, "docker-desktop") {
		return "/mnt/host/"
	}
	return "/mnt/"
}

// isLocalSystem returns true when the current process is running as the
// Windows NT AUTHORITY\SYSTEM (LocalSystem) account. ConPTY is skipped
// for LocalSystem because CreatePseudoConsole hangs in Session 0.
func isLocalSystem() bool {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return false
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return false
	}
	// S-1-5-18 is the well-known SID for LocalSystem.
	localSystem, err := windows.StringToSid("S-1-5-18")
	if err != nil {
		return false
	}
	return user.User.Sid.Equals(localSystem)
}
