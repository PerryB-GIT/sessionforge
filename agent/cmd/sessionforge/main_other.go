//go:build !windows

package main

// runAsServiceIfNeeded is a no-op on non-Windows platforms.
func runAsServiceIfNeeded() {}
