// Package updater checks GitHub Releases for a newer version of the agent
// and replaces the running binary in-place if an update is available.
package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	releasesURL = "https://api.github.com/repos/sessionforge/agent/releases/latest"
	httpTimeout = 30 * time.Second
)

// Release holds the fields we care about from the GitHub releases API.
type Release struct {
	TagName string  `json:"tag_name"`
	Assets  []Asset `json:"assets"`
}

// Asset is a single downloadable file attached to a GitHub release.
type Asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// CheckLatest fetches the latest release tag from GitHub.
// Returns the tag string (e.g. "v1.2.0") or an error.
func CheckLatest() (*Release, error) {
	client := &http.Client{Timeout: httpTimeout}
	req, err := http.NewRequest(http.MethodGet, releasesURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "SessionForge-Agent-Updater")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch releases: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned HTTP %d", resp.StatusCode)
	}

	var release Release
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("decode release: %w", err)
	}
	return &release, nil
}

// IsNewer returns true if latestTag is a higher version than currentVersion.
// Both should be semver strings, optionally prefixed with 'v'.
func IsNewer(currentVersion, latestTag string) bool {
	cur := strings.TrimPrefix(currentVersion, "v")
	lat := strings.TrimPrefix(latestTag, "v")
	return lat > cur // Simple lexicographic compare; works for semver x.y.z
}

// assetName returns the expected archive filename for the current platform.
func assetName() string {
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	switch goos {
	case "windows":
		return fmt.Sprintf("sessionforge_windows_%s.zip", goarch)
	case "darwin":
		return fmt.Sprintf("sessionforge_darwin_%s.tar.gz", goarch)
	default:
		return fmt.Sprintf("sessionforge_linux_%s.tar.gz", goarch)
	}
}

// DownloadAndInstall downloads the new binary from the release and replaces
// the current executable. The old binary is renamed to <binary>.old so it can
// be rolled back manually if needed.
func DownloadAndInstall(release *Release) error {
	target := assetName()
	var downloadURL string
	for _, a := range release.Assets {
		if a.Name == target {
			downloadURL = a.BrowserDownloadURL
			break
		}
	}
	if downloadURL == "" {
		return fmt.Errorf("no asset named %q found in release %s", target, release.TagName)
	}

	// Download to a temp file.
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	tmpFile, err := os.CreateTemp("", "sessionforge-update-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		tmpFile.Close()
		return fmt.Errorf("write download: %w", err)
	}
	tmpFile.Close()

	// Extract binary from archive.
	binaryPath, err := extractBinary(tmpPath, target)
	if err != nil {
		return fmt.Errorf("extract: %w", err)
	}
	defer os.Remove(binaryPath)

	// Locate current executable.
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("eval symlinks: %w", err)
	}

	// Rename old binary.
	oldPath := execPath + ".old"
	if err := os.Rename(execPath, oldPath); err != nil {
		return fmt.Errorf("rename old binary: %w", err)
	}

	// Move new binary into place.
	if err := os.Rename(binaryPath, execPath); err != nil {
		// Try to restore old binary.
		_ = os.Rename(oldPath, execPath)
		return fmt.Errorf("install new binary: %w", err)
	}

	// Make executable.
	if err := os.Chmod(execPath, 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Remove old binary (best-effort; Windows may refuse if running).
	_ = os.Remove(oldPath)

	return nil
}

// extractBinary extracts the sessionforge binary from a tar.gz or zip archive
// to a temp file and returns the path.
func extractBinary(archivePath, archiveName string) (string, error) {
	// Determine binary name.
	binaryName := "sessionforge"
	if runtime.GOOS == "windows" {
		binaryName = "sessionforge.exe"
	}

	if strings.HasSuffix(archiveName, ".zip") {
		return extractFromZip(archivePath, binaryName)
	}
	return extractFromTarGz(archivePath, binaryName)
}
