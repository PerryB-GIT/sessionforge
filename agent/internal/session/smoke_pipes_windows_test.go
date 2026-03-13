//go:build windows && integration

package session

import (
	"encoding/base64"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestSpawnWithPipes_NodeOutputFlows is the regression guard for the
// exec.Cmd/os.Pipe fix (L001, L008 in tasks/lessons.md).
//
// Proves that node.exe stdout reaches the parent via the pipe.
// If this test fails, someone has reverted spawnWithPipes back to
// windows.CreatePipe (non-overlapped handles → libuv silent failure).
//
// Run: go test -tags=integration -run TestSpawnWithPipes_NodeOutputFlows ./internal/session/ -v
func TestSpawnWithPipes_NodeOutputFlows(t *testing.T) {
	nodePath, err := exec.LookPath("node.exe")
	if err != nil {
		t.Skip("node.exe not in PATH — skipping integration test")
	}

	outCh := make(chan string, 16)
	doneCh := make(chan struct{})

	outputFn := func(_ string, data string) {
		select {
		case outCh <- data:
		default:
		}
	}
	exitFn := func(_ string, _ int, _ error) {
		select {
		case <-doneCh:
		default:
			close(doneCh)
		}
	}

	h, pid, err := spawnWithPipes(
		t.Context(),
		"test-smoke",
		nodePath,
		[]string{"-e", `process.stdout.write("PING\n")`},
		"",
		nil,
		outputFn,
		nil,
		exitFn,
	)
	if err != nil {
		t.Fatalf("spawnWithPipes failed: %v", err)
	}
	if pid == 0 {
		t.Fatal("expected non-zero PID")
	}
	defer h.close()

	timeout := time.After(10 * time.Second)
	for {
		select {
		case chunk := <-outCh:
			b, decErr := base64.StdEncoding.DecodeString(chunk)
			if decErr != nil {
				continue
			}
			if strings.Contains(string(b), "PING") {
				t.Logf("PASS: received PING from node.exe via exec.Cmd pipe (pid=%d)", pid)
				return
			}
		case <-doneCh:
			t.Fatal("process exited before PING was received — pipe produced no output (overlapped handle regression?)")
		case <-timeout:
			t.Fatal("TIMEOUT: no output from node.exe after 10s — pipe broken")
		}
	}
}
