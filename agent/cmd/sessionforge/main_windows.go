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
	inService, err := cli.IsWindowsService()
	if err != nil {
		// Write to a temp log so we can diagnose startup failures.
		f, _ := os.OpenFile(`C:\Windows\Temp\sessionforge-svc.log`, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if f != nil {
			fmt.Fprintf(f, "IsWindowsService error: %v\n", err)
			f.Close()
		}
		return
	}
	if inService {
		if err := cli.RunAsWindowsService(); err != nil {
			f, _ := os.OpenFile(`C:\Windows\Temp\sessionforge-svc.log`, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
			if f != nil {
				fmt.Fprintf(f, "RunAsWindowsService error: %v\n", err)
				f.Close()
			}
			os.Exit(1)
		}
		os.Exit(0)
	}
}
