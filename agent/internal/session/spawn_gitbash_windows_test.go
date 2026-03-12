//go:build windows

package session

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"
)

func TestSpawnWithGitBash_EchoOutput(t *testing.T) {
	bashPath := gitBashPath()
	if _, err := os.Stat(bashPath); err != nil {
		t.Skipf("Git Bash not available at %s — skipping", bashPath)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var outputMu sync.Mutex
	var outputChunks []string
	outputFn := func(sid, data string) {
		outputMu.Lock()
		outputChunks = append(outputChunks, data)
		outputMu.Unlock()
	}

	done := make(chan int, 1)
	exitFn := func(sid string, code int, err error) {
		done <- code
	}

	h, pid, err := spawnWithGitBash(ctx, "test-gitbash-echo", "echo hello-from-gitbash", ".", nil, outputFn, nil, exitFn)
	if err != nil {
		t.Fatalf("spawnWithGitBash: %v", err)
	}
	if pid == 0 {
		t.Fatal("expected non-zero PID")
	}

	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("expected exit code 0, got %d", code)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for process exit")
	}

	time.Sleep(100 * time.Millisecond)

	outputMu.Lock()
	chunks := outputChunks
	outputMu.Unlock()

	if len(chunks) == 0 {
		t.Fatal("expected output chunks from echo command")
	}

	_ = h
}
