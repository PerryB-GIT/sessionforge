// agent/internal/session/conversationid_windows.go
//go:build windows

package session

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// findClaudeConversationID returns the UUID of the most recently modified
// Claude Code conversation for the given workdir, or "" if not found.
//
// Claude Code stores conversations at:
//
//	<configDir>/projects/<encoded-workdir>/<uuid>.jsonl
//
// WSL sessions write to the WSL user's home (~/.claude) while Windows-native
// sessions write to the Windows config dir (C:\Users\..\.claude).
// We search both locations and return the newest match.
func findClaudeConversationID(claudeConfigDir, windowsWorkdir string) string {
	if windowsWorkdir == "" || detectedWSLDistro == "" {
		return ""
	}

	wslWorkdir, ok := windowsToWSLPath(windowsWorkdir)
	if !ok {
		return ""
	}

	// Build the suffix anchor: last 2 path components of the workdir.
	// Matches both WSL encoding (-mnt-c-Users-Jakeb-foo) and
	// Windows encoding (C--Users-Jakeb-foo).
	parts := strings.Split(strings.Trim(wslWorkdir, "/"), "/")
	suffix := strings.ReplaceAll(wslWorkdir, "/", "-")
	if len(parts) >= 2 {
		suffix = "-" + strings.Join(parts[len(parts)-2:], "-")
	}

	// Search both the Windows-side config dir (for native sessions) and the
	// WSL home dir (for WSL sessions). Combine with a semicolon so find
	// searches both trees in a single shell invocation.
	var projectsDirs []string
	if claudeConfigDir != "" {
		if wslConfigDir, ok := windowsToWSLPath(claudeConfigDir); ok {
			projectsDirs = append(projectsDirs, wslConfigDir+"/projects")
		}
	}
	// WSL home .claude — always search regardless of claudeConfigDir
	projectsDirs = append(projectsDirs, "~/.claude/projects")

	dirsArg := strings.Join(projectsDirs, " ")

	shellCmd := "find " + dirsArg + " -maxdepth 2 -name '*.jsonl'" +
		" ! -path '*/subagents/*'" +
		" -path '*" + suffix + "*'" +
		" -printf '%T@ %p\\n' 2>/dev/null" +
		" | sort -rn | head -1 | awk '{print $2}'"

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "wsl", "-d", detectedWSLDistro, "--", "sh", "-c", shellCmd).CombinedOutput()
	if err != nil {
		return ""
	}

	fullPath := strings.TrimSpace(string(out))
	if fullPath == "" {
		return ""
	}

	// Extract the UUID from the filename (strip directory and .jsonl extension)
	base := fullPath
	if idx := strings.LastIndex(base, "/"); idx >= 0 {
		base = base[idx+1:]
	}
	base = strings.TrimSuffix(base, ".jsonl")

	// Validate it looks like a UUID (8-4-4-4-12)
	if len(base) != 36 || base[8] != '-' || base[13] != '-' || base[18] != '-' || base[23] != '-' {
		return ""
	}

	return base
}
