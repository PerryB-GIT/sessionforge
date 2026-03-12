//go:build windows

package session

import (
	"context"
	"os/exec"
	"sync"
	"testing"
	"time"
)

func TestSpawnWithWSL_EchoOutput(t *testing.T) {
	if err := exec.Command("wsl", "--status").Run(); err != nil {
		t.Skip("WSL not available — skipping")
	}
	distro, ok := detectWSL()
	if !ok {
		t.Skip("WSL available but no distro with claude — skipping")
	}

	oldDistro := detectedWSLDistro
	detectedWSLDistro = distro
	defer func() { detectedWSLDistro = oldDistro }()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
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

	h, pid, err := spawnWithWSL(ctx, "test-wsl-echo", "echo hello-from-wsl", ".", nil, outputFn, nil, exitFn)
	if err != nil {
		t.Fatalf("spawnWithWSL: %v", err)
	}
	if pid == 0 {
		t.Fatal("expected non-zero PID")
	}

	select {
	case code := <-done:
		t.Logf("WSL echo exited with code %d", code)
	case <-ctx.Done():
		t.Fatal("timed out waiting for process exit")
	}

	time.Sleep(200 * time.Millisecond)

	outputMu.Lock()
	chunks := outputChunks
	outputMu.Unlock()

	if len(chunks) == 0 {
		t.Fatal("expected output chunks from WSL echo")
	}

	_ = h
}
