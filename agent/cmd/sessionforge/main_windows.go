//go:build windows

package main

import (
	"fmt"
	"os"

	"github.com/sessionforge/agent/internal/cli"
)

func init() {
	// When invoked by the Windows SCM the process has no console and
	// svc.IsWindowsService() returns true. In that case we hand control
	// to the SCM handler immediately, bypassing the CLI entirely.
	if cli.IsWindowsService() {
		if err := cli.RunAsWindowsService(); err != nil {
			fmt.Fprintln(os.Stderr, "service error:", err)
			os.Exit(1)
		}
		os.Exit(0)
	}
}
