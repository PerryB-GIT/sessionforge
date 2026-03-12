//go:build windows

package session

import (
	"context"
	"fmt"
)

// Temporary stubs — replaced by real implementations in Tasks 9 and 10.

func spawnWithWSL(
	ctx context.Context, sessionID, command, workdir string,
	env map[string]string,
	outputFn func(string, string), localOutputFn func([]byte),
	exitFn func(string, int, error),
) (*ptyHandle, int, error) {
	return nil, 0, fmt.Errorf("spawnWithWSL not yet implemented")
}

func spawnWithGitBash(
	ctx context.Context, sessionID, command, workdir string,
	env map[string]string,
	outputFn func(string, string), localOutputFn func([]byte),
	exitFn func(string, int, error),
) (*ptyHandle, int, error) {
	return nil, 0, fmt.Errorf("spawnWithGitBash not yet implemented")
}
