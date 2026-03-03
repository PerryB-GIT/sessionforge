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
	Name        string `json:"name,omitempty"`
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
	SetConPTYLogger(logger)
	return &Manager{
		registry:  NewRegistry(),
		messenger: messenger,
		ctx:       ctx,
		logger:    logger,
	}
}

// Start spawns a new PTY session and sends a 'session_started' message.
// requestId is echoed back so the cloud can correlate the response.
// sessionID is the cloud-assigned session ID; if empty, a new UUID is generated.
func (m *Manager) Start(requestID, sessionID, command, workdir string, env map[string]string) (string, error) {
	if sessionID == "" {
		sessionID = uuid.New().String()
	}

	m.logger.Info("starting session",
		"sessionId", sessionID,
		"requestId", requestID,
		"command", command,
		"workdir", workdir,
	)

	outputFn := func(sid, data string) {
		m.logger.Debug("session_output chunk", "sessionId", sid, "bytes", len(data))
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

	startedAt := time.Now().UTC()

	// Register a placeholder session entry immediately so that heartbeats
	// report sessionCount > 0 and the dashboard shows the session before
	// the ConPTY probe (which can block for several seconds) completes.
	placeholder := &Session{
		ID:          sessionID,
		PID:         0, // unknown until after spawn
		ProcessName: command,
		Workdir:     workdir,
		StartedAt:   startedAt,
		Command:     command,
	}
	m.registry.Add(placeholder)

	// Send session_started immediately so the dashboard card appears.
	earlyStarted := sessionStartedMsg{
		Type: "session_started",
		Session: sessionInfoJSON{
			ID:          sessionID,
			PID:         0,
			ProcessName: command,
			Workdir:     workdir,
			StartedAt:   startedAt.Format(time.RFC3339),
		},
	}
	if err := m.messenger.SendJSON(earlyStarted); err != nil {
		m.logger.Warn("failed to send early session_started", "err", err)
	}

	handle, pid, err := spawnPTY(m.ctx, sessionID, command, workdir, env, outputFn, nil, exitFn)
	if err != nil {
		m.registry.Remove(sessionID)
		return "", fmt.Errorf("spawn PTY: %w", err)
	}

	// Update placeholder with real PID and PTY handle.
	placeholder.PID = pid
	placeholder.ptySession = handle

	return sessionID, nil
}

// StartWithLocalOutput is like Start but also streams raw PTY bytes to localFn.
// Used by `sessionforge run` to display output in the local terminal simultaneously.
// Returns the session ID, a channel that receives the child exit code when it exits, and any error.
func (m *Manager) StartWithLocalOutput(
	requestID, sessionID, command, workdir, name string,
	env map[string]string,
	localFn func(raw []byte),
) (string, <-chan int, error) {
	if sessionID == "" {
		sessionID = uuid.New().String()
	}

	exitCh := make(chan int, 1)

	m.logger.Info("starting session with local output",
		"sessionId", sessionID,
		"requestId", requestID,
		"command", command,
		"workdir", workdir,
	)

	outputFn := func(sid, data string) {
		m.logger.Debug("session_output chunk", "sessionId", sid, "bytes", len(data))
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

		// Signal the local run loop that the process has exited.
		code := exitCode
		if exitErr != nil {
			code = -1
		}
		select {
		case exitCh <- code:
		default:
		}

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

		msg := sessionStoppedMsg{
			Type:      "session_stopped",
			SessionID: sid,
			ExitCode:  &code,
		}
		if err := m.messenger.SendJSON(msg); err != nil {
			m.logger.Warn("failed to send session_stopped", "err", err)
		}
	}

	startedAt := time.Now().UTC()

	// Register placeholder + send session_started before the ConPTY probe blocks.
	placeholder := &Session{
		ID:          sessionID,
		PID:         0,
		ProcessName: command,
		Workdir:     workdir,
		StartedAt:   startedAt,
		Command:     command,
	}
	m.registry.Add(placeholder)

	earlyStarted := sessionStartedMsg{
		Type: "session_started",
		Session: sessionInfoJSON{
			ID:          sessionID,
			PID:         0,
			ProcessName: command,
			Workdir:     workdir,
			StartedAt:   startedAt.Format(time.RFC3339),
			Name:        name,
		},
	}
	if err := m.messenger.SendJSON(earlyStarted); err != nil {
		m.logger.Warn("failed to send early session_started", "err", err)
	}

	handle, pid, err := spawnPTY(m.ctx, sessionID, command, workdir, env, outputFn, localFn, exitFn)
	if err != nil {
		m.registry.Remove(sessionID)
		return "", nil, fmt.Errorf("spawn PTY: %w", err)
	}

	placeholder.PID = pid
	placeholder.ptySession = handle

	return sessionID, exitCh, nil
}

// WriteInputRaw forwards raw bytes to a session's PTY stdin without base64 encoding.
// Used by `sessionforge run` for local stdin passthrough.
func (m *Manager) WriteInputRaw(sessionID string, data []byte) error {
	s, err := m.registry.Get(sessionID)
	if err != nil {
		return err
	}
	return s.ptySession.writeInputRaw(data)
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

// ReplayToCloud resends session_started for every currently-active session.
// Call this after a reconnect so the server stays in sync with the agent's state.
func (m *Manager) ReplayToCloud() {
	all := m.registry.GetAll()
	for _, s := range all {
		msg := sessionStartedMsg{
			Type: "session_started",
			Session: sessionInfoJSON{
				ID:          s.ID,
				PID:         s.PID,
				ProcessName: s.ProcessName,
				Workdir:     s.Workdir,
				StartedAt:   s.StartedAt.UTC().Format(time.RFC3339),
			},
		}
		if err := m.messenger.SendJSON(msg); err != nil {
			m.logger.Warn("replay: failed to send session_started", "sessionId", s.ID, "err", err)
		} else {
			m.logger.Info("replay: replayed session_started", "sessionId", s.ID)
		}
	}
}

// ManagedPIDs returns the set of PIDs for all active sessions so that the
// process scanner can exclude processes already managed by SessionForge.
func (m *Manager) ManagedPIDs() map[int32]bool {
	all := m.registry.GetAll()
	pids := make(map[int32]bool, len(all))
	for _, s := range all {
		if s.PID != 0 {
			pids[int32(s.PID)] = true
		}
	}
	return pids
}

// SetClaudePath stores the pre-resolved claude binary path so that resolveCommand
// uses it as the first lookup, before scanning PATH or npm directories.
// Call this after loading config if cfg.ClaudePath is non-empty.
func (m *Manager) SetClaudePath(path string) {
	SetClaudePath(path)
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
