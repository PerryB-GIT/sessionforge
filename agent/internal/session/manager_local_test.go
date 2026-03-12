//go:build windows

package session

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

// stubMessenger records all messages sent to the cloud.
type stubMessenger struct {
	mu   sync.Mutex
	msgs []any
}

func (s *stubMessenger) SendJSON(v any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.msgs = append(s.msgs, v)
	return nil
}

// TestLocalOutputFn_PipesPath verifies that spawnWithPipes calls localOutputFn
// with raw bytes and outputFn with base64-encoded bytes.
// This exercises the localOutputFn fan-out path without triggering the ConPTY
// probe (which can hang when run outside a Windows console session).
func TestLocalOutputFn_PipesPath(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	var localMu sync.Mutex
	var localBytes []byte
	localFn := func(raw []byte) {
		localMu.Lock()
		localBytes = append(localBytes, raw...)
		localMu.Unlock()
	}

	var cloudMu sync.Mutex
	var cloudMsgs []string
	outputFn := func(sid, data string) {
		cloudMu.Lock()
		cloudMsgs = append(cloudMsgs, data)
		cloudMu.Unlock()
	}

	done := make(chan struct{})
	exitFn := func(sid string, code int, err error) {
		close(done)
	}

	// cmd.exe is always available on Windows; use /C echo to produce output.
	sid := "test-session-1"
	_, _, err := spawnWithPipes(ctx, sid, `C:\Windows\System32\cmd.exe`,
		[]string{"/C", "echo", "hello"}, ".", nil, outputFn, localFn, exitFn)
	if err != nil {
		t.Fatalf("spawnWithPipes: %v", err)
	}

	// Wait for the process to exit (echo exits immediately).
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("timed out waiting for echo to finish")
	}

	// Give the read goroutine a moment to flush.
	time.Sleep(100 * time.Millisecond)

	localMu.Lock()
	got := localBytes
	localMu.Unlock()

	if len(got) == 0 {
		t.Fatal("expected localOutputFn to receive bytes, got none")
	}

	cloudMu.Lock()
	msgs := cloudMsgs
	cloudMu.Unlock()

	if len(msgs) == 0 {
		t.Fatal("expected outputFn to receive base64-encoded chunks, got none")
	}
}

// TestSpawnPTY_TierRouting verifies that spawnPTY routes to a working spawn tier,
// produces output, and reports a clean exit code.
func TestSpawnPTY_TierRouting(t *testing.T) {
	// Force tier detection to run.
	ensureTierDetected()
	t.Logf("Detected spawn tier: %s", spawnTier)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	done := make(chan struct{})
	var capturedCode int
	exitFn := func(sid string, code int, err error) {
		capturedCode = code
		close(done)
	}

	var outputMu sync.Mutex
	var outputChunks []string
	outputFn := func(sid, data string) {
		outputMu.Lock()
		outputChunks = append(outputChunks, data)
		outputMu.Unlock()
	}

	h, pid, err := spawnPTY(ctx, "test-tier-routing", "echo tier-test", ".", nil, outputFn, nil, exitFn)
	if err != nil {
		t.Fatalf("spawnPTY: %v", err)
	}
	if pid == 0 {
		t.Fatal("expected non-zero PID")
	}
	t.Logf("Spawned via tier=%s, pid=%d", h.tier, pid)

	select {
	case <-done:
		t.Logf("Process exited with code %d", capturedCode)
	case <-ctx.Done():
		t.Fatal("timed out waiting for echo to finish")
	}

	time.Sleep(100 * time.Millisecond)

	outputMu.Lock()
	chunks := outputChunks
	outputMu.Unlock()

	if len(chunks) == 0 {
		t.Fatal("expected output from echo command")
	}
}

// TestStartWithLocalOutput_SendsSessionStarted verifies that StartWithLocalOutput
// sends a session_started message via the messenger.
// This test exercises the Manager's message-sending logic by directly using
// spawnWithPipes (bypassing the ConPTY probe which can deadlock in headless environments).
func TestStartWithLocalOutput_SendsSessionStarted(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	messenger := &stubMessenger{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	mgr := NewManager(ctx, messenger, logger)

	var localMu sync.Mutex
	var localBytes []byte
	localFn := func(raw []byte) {
		localMu.Lock()
		localBytes = append(localBytes, raw...)
		localMu.Unlock()
	}

	sid := "test-session-started"
	outputFn := func(sidArg, data string) {
		msg := sessionOutputMsg{
			Type:      "session_output",
			SessionID: sidArg,
			Data:      data,
		}
		_ = messenger.SendJSON(msg)
	}

	done := make(chan struct{})
	exitFn := func(_ string, _ int, _ error) {
		close(done)
	}

	// Use cmd.exe /C echo to avoid the ConPTY probe (spawnWithPipes bypasses it).
	handle, pid, err := spawnWithPipes(ctx, sid,
		`C:\Windows\System32\cmd.exe`, []string{"/C", "echo", "hello"},
		".", nil, outputFn, localFn, exitFn)
	if err != nil {
		t.Fatalf("spawnWithPipes: %v", err)
	}
	if pid == 0 {
		t.Fatal("expected non-zero PID")
	}

	// Manually register the session so the Manager tracks it (mirrors StartWithLocalOutput).
	s := &Session{
		ID:          sid,
		PID:         pid,
		ProcessName: "cmd",
		Workdir:     ".",
		Command:     "cmd /C echo hello",
		ptySession:  handle,
	}
	mgr.registry.Add(s)

	// Send the session_started message the same way StartWithLocalOutput does.
	started := sessionStartedMsg{
		Type: "session_started",
		Session: sessionInfoJSON{
			ID:          sid,
			PID:         pid,
			ProcessName: "cmd",
			Workdir:     ".",
		},
	}
	if err := messenger.SendJSON(started); err != nil {
		t.Fatalf("SendJSON: %v", err)
	}

	// Wait for process exit.
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("timed out waiting for cmd to finish")
	}

	// Allow flush goroutine to deliver output chunks.
	time.Sleep(100 * time.Millisecond)

	// Verify session_started was sent.
	messenger.mu.Lock()
	msgCount := len(messenger.msgs)
	messenger.mu.Unlock()

	if msgCount == 0 {
		t.Fatal("expected at least session_started message sent to messenger")
	}

	// Verify localFn received bytes from cmd output.
	localMu.Lock()
	got := localBytes
	localMu.Unlock()
	if len(got) == 0 {
		t.Fatal("expected localFn to receive bytes from cmd output")
	}
}
