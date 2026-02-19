package system

import (
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
)

// Metrics holds a point-in-time snapshot of system resource usage.
type Metrics struct {
	CPUPercent    float64
	MemoryPercent float64
	DiskPercent   float64
}

// GetCPUPercent returns the overall CPU utilisation percentage (0–100).
// The measurement is taken over a 200ms interval for accuracy.
func GetCPUPercent() float64 {
	percents, err := cpu.Percent(200*time.Millisecond, false)
	if err != nil || len(percents) == 0 {
		return 0
	}
	return round2(percents[0])
}

// GetMemoryPercent returns the percentage of RAM currently in use (0–100).
func GetMemoryPercent() float64 {
	v, err := mem.VirtualMemory()
	if err != nil {
		return 0
	}
	return round2(v.UsedPercent)
}

// GetDiskPercent returns the usage percentage of the root/system disk (0–100).
func GetDiskPercent() float64 {
	path := rootDiskPath()
	u, err := disk.Usage(path)
	if err != nil {
		return 0
	}
	return round2(u.UsedPercent)
}

// Collect returns a Metrics snapshot.
// CPU measurement introduces a ~200ms blocking call; call from a goroutine if latency matters.
func Collect() Metrics {
	return Metrics{
		CPUPercent:    GetCPUPercent(),
		MemoryPercent: GetMemoryPercent(),
		DiskPercent:   GetDiskPercent(),
	}
}

// round2 rounds f to 2 decimal places.
func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}
