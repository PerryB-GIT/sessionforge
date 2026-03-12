// agent/internal/session/tier_stub.go
//go:build !windows

package session

// WarmUpSpawnTier is a no-op on non-Windows platforms.
// The Unix path uses creack/pty directly and has no tier detection.
func WarmUpSpawnTier() {}

// WarmUpConPTY is a no-op on non-Windows platforms.
// ConPTY is a Windows-only API; Unix sessions use creack/pty directly.
func WarmUpConPTY() {}
