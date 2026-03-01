package updater

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// extractFromTarGz extracts a named file from a .tar.gz archive into a temp file.
// Returns the path to the extracted file.
func extractFromTarGz(archivePath, targetName string) (string, error) {
	f, err := os.Open(archivePath)
	if err != nil {
		return "", fmt.Errorf("open archive: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", fmt.Errorf("gzip reader: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("tar next: %w", err)
		}

		base := filepath.Base(hdr.Name)
		if base != targetName {
			continue
		}

		tmp, err := os.CreateTemp("", "sessionforge-bin-*")
		if err != nil {
			return "", fmt.Errorf("create temp: %w", err)
		}
		if _, err := io.Copy(tmp, tr); err != nil {
			tmp.Close()
			os.Remove(tmp.Name())
			return "", fmt.Errorf("extract binary: %w", err)
		}
		tmp.Close()
		return tmp.Name(), nil
	}

	return "", fmt.Errorf("binary %q not found in archive", targetName)
}

// extractFromZip extracts a named file from a .zip archive into a temp file.
// Returns the path to the extracted file.
func extractFromZip(archivePath, targetName string) (string, error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return "", fmt.Errorf("open zip: %w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		base := filepath.Base(f.Name)
		if !strings.EqualFold(base, targetName) {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("open zip entry: %w", err)
		}
		defer rc.Close()

		tmp, err := os.CreateTemp("", "sessionforge-bin-*")
		if err != nil {
			return "", fmt.Errorf("create temp: %w", err)
		}
		if _, err := io.Copy(tmp, rc); err != nil {
			tmp.Close()
			os.Remove(tmp.Name())
			return "", fmt.Errorf("extract binary: %w", err)
		}
		tmp.Close()
		return tmp.Name(), nil
	}

	return "", fmt.Errorf("binary %q not found in zip archive", targetName)
}
