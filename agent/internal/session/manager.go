package session

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// AgentMessenger is the interface the Manager uses to send messages back to the cloud.
// It is implemented by connection.Client.
type AgentMessenger interface {
	// SendJSON queues an arbitrary JSON-serialisable message for delivery.
	SendJSON(v any) error
}

// sessionStartedMsg matches the AgentMessage 'session_started' type.
type sessionStartedMsg struct {
	Type    string          `json:"type"`
	Session sessionInfoJSON `json:"session"`
}

type sessionInfoJSON struct {
	ID          string `json:"id"`
	PID         int    `json:"pid"`
	ProcessName string `json:"processName"`
	Workdir     string `json:"workdir"`
	StartedAt   string `json:"startedAt"`
}

type sessionStoppedMsg struct {
	Type      string  `json:"type"`
	SessionID string  `json:"sessionId"`
	ExitCode  *int    `json:"exitCode"`
}

type sessionCrashedMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Error     string `json:"error"`
}

type sessionOutputMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Data      string `json:"data"` // base64 encoded
}

// Manager handles the lifecycle of all terminal sessions.
type Manager struct {
	registry  *Registry
	messenger AgentMessenger
	ctx       context.Context
	logger    *slog.Logger
}

// NewManager creates a new Manager.
func NewManager(ctx context.Context, messenger AgentMessenger, logger *slog.Logger) *Manager {
	return &Manager{
		registry:  NewRegistry(),
		messenger: messenger,
		ctx:       ctx,
		logger:    logger,
	}
}

// Start spawns a new PTY session and sends a 'session_started' message.
// requestId is echoed back so the cloud can correlate the response.
func (m *Manager) Start(requestID, command, workdir string, env map[string]string) (string, error) {
	sessionID := uuid.New().String()

	m.logger.Info("starting session",
		"sessionId", sessionID,
		"requestId", requestID,
		"command", command,
		"workdir", workdir,
	)

	outputFn := func(sid, data string) {
		msg := sessionOutputMsg{
			Type:      "session_output",
			SessionID: sid,
			Data:      data,
		}
		if err := m.messenger.SendJSON(msg); err != nil {
			m.logger.Warn("failed to send session_output", "sessionId", sid, "err", err)
		}
	}

	exitFn := func(sid string, exitCode int, exitErr error) {
		m.logger.Info("session exited", "sessionId", sid, "exitCode", exitCode, "err", exitErr)
		m.registry.Remove(sid)

		if exitErr != nil {
			msg := sessionCrashedMsg{
				Type:      "session_crashed",
				SessionID: sid,
				Error:     exitErr.Error(),
			}
			if err := m.messenger.SendJSON(msg); err != nil {
				m.logger.Warn("failed to send session_crashed", "err", err)
			}
			return
		}

		code := exitCode
		msg := sessionStoppedMsg{
			Type:      "session_stopped",
			SessionID: sid,
			ExitCode:  &code,
		}
		if err := m.messenger.SendJSON(msg); err != nil {
			m.logger.Warn("failed to send session_stopped", "err", err)
		}
	}

	handle, pid, err := spawnPTY(m.ctx, sessionID, command, workdir, env, outputFn, exitFn)
	if err != nil {
		return "", fmt.Errorf("spawn PTY: %w", err)
	}

	s := &Session{
		ID:          sessionID,
		PID:         pid,
		ProcessName: command,
		Workdir:     workdir,
		StartedAt:   time.Now().UTC(),
		Command:     command,
		ptySession:  handle,
	}
	m.registry.Add(s)

	// Send session_started notification.
	started := sessionStartedMsg{
		Type: "session_started",
		Session: sessionInfoJSON{
			ID:          sessionID,
			PID:         pid,
			ProcessName: command,
			Workdir:     workdir,
			StartedAt:   s.StartedAt.Format(time.RFC3339),
		},
	}
	if err := m.messenger.SendJSON(started); err != nil {
		m.logger.Warn("failed to send session_started", "err", err)
	}

	return sessionID, nil
}

// Stop terminates a session. If force is true, the process is killed immediately.
func (m *Manager) Stop(sessionID string, force bool) error {
	s, err := m.registry.Get(sessionID)
	if err != nil {
		return err
	}
	m.logger.Info("stopping session", "sessionId", sessionID, "force", force)
	return s.ptySession.stop(force)
}

// Pause suspends a session (SIGSTOP on Unix).
func (m *Manager) Pause(sessionID string) error {
	s, err := m.registry.Get(sessionID)
	if err != nil {
		return err
	}
	m.logger.Info("pausing session", "sessionId", sessionID)
	return s.ptySession.pause()
}

// Resume continues a paused session (SIGCONT on Unix).
func (m *Manager) Resume(sessionID string) error {
	s, err := m.registry.Get(sessionID)
	if err != nil {
		return err
	}
	m.logger.Info("resuming session", "sessionId", sessionID)
	return s.ptySession.resume()
}

// WriteInput forwards base64-encoded input bytes to a session's PTY stdin.
func (m *Manager) WriteInput(sessionID, data string) error {
	s, err := m.registry.Get(sessionID)
	if err != nil {
		return err
	}
	return s.ptySession.writeInput(data)
}

// Resize adjusts the PTY dimensions for a session.
func (m *Manager) Resize(sessionID string, cols, rows uint16) error {
	s, err := m.registry.Get(sessionID)
	if err != nil {
		return err
	}
	return s.ptySession.resize(cols, rows)
}

// GetAll returns a snapshot of all active sessions.
func (m *Manager) GetAll() []*Session {
	return m.registry.GetAll()
}

// Count returns the number of active sessions.
func (m *Manager) Count() int {
	return m.registry.Count()
}

// StopAll gracefully stops all active sessions. Called on agent shutdown.
func (m *Manager) StopAll() {
	for _, s := range m.registry.GetAll() {
		m.logger.Info("stopping session on shutdown", "sessionId", s.ID)
		if err := s.ptySession.stop(false); err != nil {
			// Force kill if graceful stop fails.
			_ = s.ptySession.stop(true)
		}
		s.ptySession.close()
	}
}
