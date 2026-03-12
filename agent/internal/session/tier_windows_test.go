//go:build windows

package session

import (
	"testing"
)

func TestDetectSpawnTier_ReturnsNonEmpty(t *testing.T) {
	// detectSpawnTier should always return a valid tier, even if all
	// tiers fail — the fallback is "conpty" or "pipes".
	tier := detectSpawnTier()
	if tier == "" {
		t.Fatal("detectSpawnTier returned empty string; expected one of: wsl, gitbash, conpty, pipes")
	}
	validTiers := map[string]bool{"wsl": true, "gitbash": true, "conpty": true, "pipes": true}
	if !validTiers[tier] {
		t.Fatalf("detectSpawnTier returned %q; expected one of: wsl, gitbash, conpty, pipes", tier)
	}
}

func TestDetectWSL_DoesNotPanic(t *testing.T) {
	distro, ok := detectWSL()
	t.Logf("detectWSL: distro=%q ok=%v", distro, ok)
	if ok && distro == "" {
		t.Fatal("detectWSL returned ok=true but empty distro")
	}
}

func TestDetectGitBash_DoesNotPanic(t *testing.T) {
	bashPath, ok := detectGitBash()
	t.Logf("detectGitBash: bashPath=%q ok=%v", bashPath, ok)
	if ok && bashPath == "" {
		t.Fatal("detectGitBash returned ok=true but empty bashPath")
	}
}

func TestWindowsToWSLPath(t *testing.T) {
	tests := []struct {
		input  string
		want   string
		wantOK bool
	}{
		{`C:\Users\Jakeb\project`, "/mnt/c/Users/Jakeb/project", true},
		{`D:\code`, "/mnt/d/code", true},
		{`C:/Users/Jakeb`, "/mnt/c/Users/Jakeb", true},
		{`\\server\share`, "", false},
		{`/some/unix/path`, "/some/unix/path", true},
	}
	for _, tc := range tests {
		got, ok := windowsToWSLPath(tc.input)
		if ok != tc.wantOK {
			t.Errorf("windowsToWSLPath(%q): ok=%v, want %v", tc.input, ok, tc.wantOK)
			continue
		}
		if got != tc.want {
			t.Errorf("windowsToWSLPath(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
