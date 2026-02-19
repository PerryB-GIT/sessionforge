package connection

import (
	"context"
	"log/slog"
	"time"

	"github.com/sessionforge/agent/internal/system"
)

const heartbeatInterval = 30 * time.Second

// heartbeatMsg matches the AgentMessage 'heartbeat' type in the WebSocket protocol.
type heartbeatMsg struct {
	Type         string  `json:"type"`
	MachineID    string  `json:"machineId"`
	CPU          float64 `json:"cpu"`
	Memory       float64 `json:"memory"`
	Disk         float64 `json:"disk"`
	SessionCount int     `json:"sessionCount"`
}

// SessionCounter is satisfied by session.Manager.
type SessionCounter interface {
	Count() int
}

// RunHeartbeat sends a heartbeat every 30 seconds until ctx is cancelled.
// It collects live CPU/RAM/disk metrics on each tick.
func RunHeartbeat(ctx context.Context, client *Client, machineID string, sessions SessionCounter, logger *slog.Logger) {
	logger.Info("heartbeat: started", "interval", heartbeatInterval)
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	send := func() {
		metrics := system.Collect()
		msg := heartbeatMsg{
			Type:         "heartbeat",
			MachineID:    machineID,
			CPU:          metrics.CPUPercent,
			Memory:       metrics.MemoryPercent,
			Disk:         metrics.DiskPercent,
			SessionCount: sessions.Count(),
		}
		if err := client.SendJSON(msg); err != nil {
			logger.Warn("heartbeat: send failed", "err", err)
		} else {
			logger.Debug("heartbeat: sent",
				"cpu", msg.CPU,
				"memory", msg.Memory,
				"disk", msg.Disk,
				"sessions", msg.SessionCount,
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
