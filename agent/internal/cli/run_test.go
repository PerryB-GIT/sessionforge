package cli

import (
	"bytes"
	"io"
	"testing"
)

// detectDetach returns true if byte 29 (Ctrl+]) is the first byte of data.
func detectDetach(data []byte) bool {
	return len(data) > 0 && data[0] == 29
}

func TestDetectDetach_CtrlBracket(t *testing.T) {
	if !detectDetach([]byte{29}) {
		t.Fatal("expected Ctrl+] (byte 29) to be detected as detach")
	}
}

func TestDetectDetach_NormalInput(t *testing.T) {
	for _, b := range []byte("hello world") {
		if detectDetach([]byte{b}) {
			t.Fatalf("byte %d should not trigger detach", b)
		}
	}
}

func TestDetectDetach_EmptyInput(t *testing.T) {
	if detectDetach([]byte{}) {
		t.Fatal("empty input should not trigger detach")
	}
}

// TestStdinPassthroughForwardsBytes verifies that non-detach bytes
// from a reader are forwarded to the write function.
func TestStdinPassthroughForwardsBytes(t *testing.T) {
	input := bytes.NewReader([]byte("ls\n"))
	var written []byte
	writeFn := func(data []byte) error {
		written = append(written, data...)
		return nil
	}

	buf := make([]byte, 256)
	for {
		n, err := input.Read(buf)
		if n > 0 && !detectDetach(buf[:n]) {
			writeFn(buf[:n])
		}
		if err == io.EOF {
			break
		}
	}

	if string(written) != "ls\n" {
		t.Fatalf("expected 'ls\\n', got %q", written)
	}
}
