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
		return
	}

	// Step 3: ConPTY probe (existing logic)
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
}

// ── WSL Detection ───────────────────────────────────────────────────────────

func detectWSL() (string, bool) {
	logger := conPTYWorkingLogger

	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()
	out, err := exec.CommandContext(ctx2, "wsl", "--list", "--quiet").CombinedOutput()
	if err != nil {
		if logger != nil {
			logger.Debug("WSL detection: --list failed", "err", err)
		}
		return "", false
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) == "" {
		if logger != nil {
			logger.Debug("WSL detection: no distros found")
		}
		return "", false
	}
	distro := strings.TrimSpace(lines[0])
	distro = strings.ReplaceAll(distro, "\x00", "")
	distro = strings.TrimPrefix(distro, "\ufeff")
	distro = strings.TrimSpace(distro)
	if distro == "" {
		return "", false
	}

	ctx3, cancel3 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel3()
	claudeOut, err := exec.CommandContext(ctx3, "wsl", "-d", distro, "--", "which", "claude").CombinedOutput()
	if err != nil {
		if logger != nil {
			logger.Debug("WSL detection: claude not found in distro", "distro", distro, "err", err)
		}
		return "", false
	}
	claudePath := strings.TrimSpace(string(claudeOut))
	if claudePath == "" {
		return "", false
	}

	if logger != nil {
		logger.Info("WSL detection: claude found", "distro", distro, "claudePath", claudePath)
	}
	return distro, true
}

// ── Git Bash Detection ──────────────────────────────────────────────────────

func detectGitBash() (string, bool) {
	logger := conPTYWorkingLogger

	bashPath := gitBashPath()
	if _, err := os.Stat(bashPath); err != nil {
		if logger != nil {
			logger.Debug("Git Bash detection: bash.exe not found", "path", bashPath, "err", err)
		}
		return "", false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bashPath, "-l", "-c", "which claude").CombinedOutput()
	if err != nil {
		if logger != nil {
			logger.Debug("Git Bash detection: claude not found", "err", err, "output", string(out))
		}
		return "", false
	}

	claudePath := strings.TrimSpace(string(out))
	if logger != nil {
		logger.Info("Git Bash detection: claude found", "bashPath", bashPath, "claudePath", claudePath)
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
	exe, err := os.Executable()
	if err != nil {
		if logger := conPTYWorkingLogger; logger != nil {
			logger.Warn("gitBashPath: os.Executable failed", "err", err)
		}
		return ""
	}
	installDir := filepath.Dir(exe)
	return filepath.Join(installDir, "gitbash", "bin", "bash.exe")
}

// windowsToWSLPath converts a Windows path like "C:\Users\Jakeb\project"
// to a WSL path like "/mnt/c/Users/Jakeb/project".
func windowsToWSLPath(winPath string) (string, bool) {
	if strings.HasPrefix(winPath, `\\`) {
		return "", false
	}

	p := strings.ReplaceAll(winPath, `\`, "/")

	if len(p) >= 2 && p[1] == ':' {
		drive := strings.ToLower(string(p[0]))
		rest := p[2:]
		return "/mnt/" + drive + rest, true
	}

	return p, true
}
