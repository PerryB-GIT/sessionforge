//go:build windows

package cli

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

type termState struct {
	oldMode uint32
}

// enableVirtualTerminalProcessing ensures ANSI escape codes render in the Windows console.
func enableVirtualTerminalProcessing() {
	stdout := windows.Handle(os.Stdout.Fd())
	var mode uint32
	if windows.GetConsoleMode(stdout, &mode) == nil {
		windows.SetConsoleMode(stdout, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING)
	}
}

func setRawMode() (*termState, error) {
	handle := windows.Handle(os.Stdin.Fd())
	var oldMode uint32
	if err := windows.GetConsoleMode(handle, &oldMode); err != nil {
		return nil, fmt.Errorf("GetConsoleMode: %w", err)
	}
	// Remove line-buffering, echo, and processed input so keystrokes
	// are forwarded byte-by-byte to the PTY.
	newMode := oldMode &^ (windows.ENABLE_ECHO_INPUT |
		windows.ENABLE_LINE_INPUT |
		windows.ENABLE_PROCESSED_INPUT)
	if err := windows.SetConsoleMode(handle, newMode); err != nil {
		return nil, fmt.Errorf("SetConsoleMode: %w", err)
	}
	enableVirtualTerminalProcessing()
	return &termState{oldMode: oldMode}, nil
}

func restoreMode(s *termState) {
	if s == nil {
		return
	}
	handle := windows.Handle(os.Stdin.Fd())
	_ = windows.SetConsoleMode(handle, s.oldMode)
}
