package connection

import (
	"context"
	"log/slog"
	"strings"
	"time"

	goproc "github.com/shirou/gopsutil/v3/process"

	"github.com/sessionforge/agent/internal/system"
)

const heartbeatInterval = 10 * time.Second

// discoveredProcess mirrors the DiscoveredProcess type in ws-protocol.ts.
type discoveredProcess struct {
	PID     int32  `json:"pid"`
	Name    string `json:"name"`
	Cmdline string `json:"cmdline"`
	Workdir string `json:"workdir"`
}

// heartbeatMsg matches the AgentMessage 'heartbeat' type in the WebSocket protocol.
type heartbeatMsg struct {
	Type                string              `json:"type"`
	MachineID           string              `json:"machineId"`
	CPU                 float64             `json:"cpu"`
	Memory              float64             `json:"memory"`
	Disk                float64             `json:"disk"`
	SessionCount        int                 `json:"sessionCount"`
	DiscoveredProcesses []discoveredProcess `json:"discoveredProcesses"`
}

// processAllowList is the set of executable names worth reporting as discoverable.
var processAllowList = map[string]bool{
	"claude": true,
}

// SessionCounter is satisfied by session.Manager (Count method).
type SessionCounter interface {
	Count() int
}

// SessionPIDLister is satisfied by session.Manager (ManagedPIDs method).
// It returns the set of PIDs currently managed by SessionForge so that
// process scanning can exclude them from the discovered list.
type SessionPIDLister interface {
	ManagedPIDs() map[int32]bool
}

// SessionScanner combines both interfaces — session.Manager satisfies both.
type SessionScanner interface {
	SessionCounter
	SessionPIDLister
}

// scanProcesses returns a list of running processes that match the allow-list
// and are NOT already managed by SessionForge (i.e. not in managedPIDs).
// Errors from individual process attribute reads are ignored silently —
// this runs inside a Windows SCM service with no console, so best-effort is correct.
func scanProcesses(managedPIDs map[int32]bool) []discoveredProcess {
	procs, err := goproc.Processes()
	if err != nil {
		return nil
	}

	var found []discoveredProcess
	for _, p := range procs {
		if managedPIDs[p.Pid] {
			continue
		}
		name, err := p.Name()
		if err != nil {
			continue
		}
		// Normalise: strip .exe suffix, lower-case
		nameLower := strings.ToLower(strings.TrimSuffix(name, ".exe"))

		cmdline, _ := p.Cmdline()
		cwd, _ := p.Cwd()

		// Direct match (e.g. a native claude binary).
		matched := processAllowList[nameLower]

		// On Windows, claude is an npm-installed .cmd script run via node.exe.
		// Detect it by checking if the node process cmdline contains "claude".
		if !matched && nameLower == "node" && strings.Contains(strings.ToLower(cmdline), "claude") {
			matched = true
			nameLower = "claude" // report it as "claude" regardless of the host binary
		}

		if !matched {
			continue
		}

		found = append(found, discoveredProcess{
			PID:     p.Pid,
			Name:    nameLower,
			Cmdline: cmdline,
			Workdir: cwd,
		})
	}
	if found == nil {
		found = []discoveredProcess{} // always return empty slice, never null in JSON
	}
	return found
}

// RunHeartbeat sends a heartbeat every 10 seconds until ctx is cancelled.
// It collects live CPU/RAM/disk metrics and scans for unmanaged processes on each tick.
func RunHeartbeat(ctx context.Context, client *Client, machineID string, sessions SessionScanner, logger *slog.Logger) {
	logger.Info("heartbeat: started", "interval", heartbeatInterval)
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	send := func() {
		metrics := system.Collect()
		managedPIDs := sessions.ManagedPIDs()
		discovered := scanProcesses(managedPIDs)
		msg := heartbeatMsg{
			Type:                "heartbeat",
			MachineID:           machineID,
			CPU:                 metrics.CPUPercent,
			Memory:              metrics.MemoryPercent,
			Disk:                metrics.DiskPercent,
			SessionCount:        sessions.Count(),
			DiscoveredProcesses: discovered,
		}
		if err := client.SendJSON(msg); err != nil {
			logger.Warn("heartbeat: send failed", "err", err)
		} else {
			logger.Debug("heartbeat: sent",
				"cpu", msg.CPU,
				"memory", msg.Memory,
				"disk", msg.Disk,
				"sessions", msg.SessionCount,
				"discovered", len(discovered),
			)
		}
	}

	// Send an immediate heartbeat on connection so the cloud has initial data.
	send()

	for {
		select {
		case <-ctx.Done():
			logger.Info("heartbeat: stopped")
			return
		case <-ticker.C:
			send()
		}
	}
}
