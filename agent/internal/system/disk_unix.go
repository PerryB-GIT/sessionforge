//go:build !windows

package system

// rootDiskPath returns the mount point of the primary disk on Unix-like systems.
func rootDiskPath() string {
	return "/"
}
