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
//	<claudeConfigDir>/projects/<encoded-workdir>/<uuid>.jsonl
//
// The encoded key replaces path separators with "-". For a WSL path like
// /mnt/c/Users/Jakeb/foo the key is -mnt-c-Users-Jakeb-foo.
// For a Windows path C:\Users\Jakeb\foo converted to WSL it is the same.
func findClaudeConversationID(claudeConfigDir, windowsWorkdir string) string {
	if claudeConfigDir == "" || windowsWorkdir == "" || detectedWSLDistro == "" {
		return ""
	}

	wslConfigDir, ok := windowsToWSLPath(claudeConfigDir)
	if !ok {
		return ""
	}

	wslWorkdir, ok := windowsToWSLPath(windowsWorkdir)
	if !ok {
		return ""
	}

	// Claude encodes the workdir by replacing '/' with '-'.
	// Leading '/' becomes a leading '-', so strip it for the glob.
	encodedKey := strings.ReplaceAll(wslWorkdir, "/", "-")

	projectsDir := wslConfigDir + "/projects"

	// Use a glob that matches both with and without the leading '-'
	// e.g. -mnt-c-Users-Jakeb-foo OR C--Users-Jakeb-foo (Windows-style encoding)
	// We find the newest .jsonl across any subdirectory whose name ends with
	// the last two components of the workdir (robust against prefix differences).
	parts := strings.Split(strings.Trim(wslWorkdir, "/"), "/")
	suffix := encodedKey
	if len(parts) >= 2 {
		// Use last 2 path components as a suffix anchor for the glob
		suffix = "-" + strings.Join(parts[len(parts)-2:], "-")
	}

	shellCmd := "find " + projectsDir + " -maxdepth 2 -name '*.jsonl'" +
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
