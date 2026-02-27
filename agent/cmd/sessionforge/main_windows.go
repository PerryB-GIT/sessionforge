//go:build windows

package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/sessionforge/agent/internal/cli"
)

func init() {
	// When invoked by the Windows SCM the process has no console and
	// svc.IsWindowsService() returns true. In that case we hand control
	// to the SCM handler immediately, bypassing the Cobra CLI entirely.
	//
	// Because we bypass Cobra, flags like --config-dir are never parsed.
	// We manually scan os.Args for --config-dir so the daemon can find
	// the correct config.toml regardless of which user account owns the service.
	inService, err := cli.IsWindowsService()
	if err != nil {
		f, _ := os.OpenFile(`C:\Windows\Temp\sessionforge-svc.log`, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if f != nil {
			fmt.Fprintf(f, "IsWindowsService error: %v\n", err)
			f.Close()
		}
		return
	}
	if inService {
		// Parse --config-dir from the SCM-supplied arguments before handing
		// off to the service handler (Cobra never runs in this path).
		for i, arg := range os.Args {
			if arg == "--config-dir" && i+1 < len(os.Args) {
				cli.SetConfigDir(os.Args[i+1])
				break
			}
			if strings.HasPrefix(arg, "--config-dir=") {
				cli.SetConfigDir(strings.TrimPrefix(arg, "--config-dir="))
				break
			}
		}

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
