// Package system provides helpers for collecting machine identity and static metadata.
package system

import (
	"fmt"
	"os"
	"runtime"
	"strings"

	"github.com/google/uuid"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/mem"
)

// GetOS returns a normalised OS identifier: "windows", "macos", or "linux".
func GetOS() string {
	switch runtime.GOOS {
	case "darwin":
		return "macos"
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}

// GetHostname returns the machine's hostname.
func GetHostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

// GetCPUModel returns the CPU model name string (e.g. "Apple M2", "Intel Core i7-12700").
// Returns "unknown" if not determinable.
func GetCPUModel() string {
	infos, err := cpu.Info()
	if err != nil || len(infos) == 0 {
		return "unknown"
	}
	model := strings.TrimSpace(infos[0].ModelName)
	if model == "" {
		return "unknown"
	}
	return model
}

// GetRAMGB returns total system RAM in gigabytes (rounded to 1 decimal place).
func GetRAMGB() float64 {
	v, err := mem.VirtualMemory()
	if err != nil {
		return 0
	}
	gb := float64(v.Total) / (1024 * 1024 * 1024)
	// Round to 1 decimal place.
	return float64(int(gb*10+0.5)) / 10
}

// GenerateMachineID creates a new random UUID to use as a persistent machine identifier.
func GenerateMachineID() string {
	return uuid.New().String()
}

// SummaryString returns a human-readable one-liner summary of the machine.
func SummaryString() string {
	return fmt.Sprintf("%s | %s | CPU: %s | RAM: %.1f GB",
		GetHostname(),
		GetOS(),
		GetCPUModel(),
		GetRAMGB(),
	)
}
