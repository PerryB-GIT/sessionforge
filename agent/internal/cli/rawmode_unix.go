//go:build !windows

package cli

import (
	"os"

	"golang.org/x/term"
)

type termState struct {
	state *term.State
}

func setRawMode() (*termState, error) {
	fd := int(os.Stdin.Fd())
	old, err := term.MakeRaw(fd)
	if err != nil {
		return nil, err
	}
	return &termState{state: old}, nil
}

func restoreMode(s *termState) {
	if s != nil {
		term.Restore(int(os.Stdin.Fd()), s.state)
	}
}
