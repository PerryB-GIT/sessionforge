//go:build windows

package system

// rootDiskPath returns the Windows system drive root.
func rootDiskPath() string {
	return "C:\\"
}
