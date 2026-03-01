//go:build windows

package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/sessionforge/agent/internal/cli"
)

// runAsServiceIfNeeded checks whether the process was started by the Windows SCM
// and, if so, hands off to the SCM handler and exits. Must be called from main()
// after the Go runtime is fully initialized (NOT from init()).
//
// When the SCM starts the service it passes the registered binary arguments
// (e.g. --config-dir C:\Users\Perry\.sessionforge). Cobra never runs in this
// path, so we scan os.Args manually and apply the flag before the daemon starts.
func runAsServiceIfNeeded() {
	inService, err := cli.IsWindowsService()
	if err != nil {
		logToFile(fmt.Sprintf("IsWindowsService error: %v", err))
		return
	}
	if !inService {
		return
	}

	// Parse --config-dir from the SCM-supplied arguments.
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
		logToFile(fmt.Sprintf("RunAsWindowsService error: %v", err))
		os.Exit(1)
	}
	os.Exit(0)
}

func logToFile(msg string) {
	f, err := os.OpenFile(`C:\Windows\Temp\sessionforge-svc.log`, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintln(f, msg)
}
