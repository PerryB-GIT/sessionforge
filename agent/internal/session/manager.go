package session

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sessionforge/agent/internal/debuglog"
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
	Type                 string `json:"type"`
	SessionID            string `json:"sessionId"`
	ExitCode             *int   `json:"exitCode"`
	ClaudeConversationID string `json:"claudeConversationId,omitempty"`
}

type sessionCrashedMsg struct {
	Type                 string `json:"type"`
	SessionID            string `json:"sessionId"`
	Error                string `json:"error"`
	ClaudeConversationID string `json:"claudeConversationId,omitempty"`
}

type sessionOutputMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Data      string `json:"data"` // base64 encoded
}

// managerDebugLog is the package-level debug log client, accessible from tier_windows.go.
var managerDebugLog *debuglog.Client

// SetManagerDebugLog sets the package-level debug log client.
func SetManagerDebugLog(dl *debuglog.Client) {
	managerDebugLog = dl
}

// Manager handles the lifecycle of all terminal sessions.
type Manager struct {
	registry        *Registry
	messenger       AgentMessenger
	ctx             context.Context
	logger          *slog.Logger
	claudeConfigDir string // injected as CLAUDE_CONFIG_DIR into every PTY session
	debugLog        *debuglog.Client
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

// SetClaudeConfigDir stores the path to inject as CLAUDE_CONFIG_DIR in every
// spawned session. Call this after loading config if cfg.ClaudeConfigDir is set.
func (m *Manager) SetClaudeConfigDir(dir string) {
	m.claudeConfigDir = dir
}

// SetDebugLogger wires a debug log client into the manager and the package-level
// variable used by tier_windows.go. Safe to call before or after Start().
func (m *Manager) SetDebugLogger(dl *debuglog.Client) {
	m.debugLog = dl
	SetManagerDebugLog(dl)
}

// mergeEnv returns a copy of env with CLAUDE_CONFIG_DIR injected if configured.
func (m *Manager) mergeEnv(env map[string]string) map[string]string {
	if m.claudeConfigDir == "" {
		return env
	}
	merged := make(map[string]string, len(env)+1)
	for k, v := range env {
		merged[k] = v
	}
	merged["CLAUDE_CONFIG_DIR"] = m.claudeConfigDir
	return merged
}

// Start spawns a new PTY session and sends a 'session_started' message.
// requestId is echoed back so the cloud can correlate the response.
// sessionID is the cloud-assigned session ID; if empty, a new UUID is generated.
// sanitizeWorkdir validates a client-supplied working directory.
// Rejects UNC paths (\\server\share). Falls back to fallbackHome on any
// rejection so the session always starts somewhere safe and writable.
// fallbackHome should be the real user's home dir (from claude_config_dir),
// NOT os.UserHomeDir() which returns LocalSystem's profile when running
// as a Windows service (C:\Windows\system32\config\systemprofile).
func sanitizeWorkdir(workdir, fallbackHome string) string {
	// Reject UNC paths — could be used to capture NTLM credentials.
	if strings.HasPrefix(workdir, `\\`) || strings.HasPrefix(workdir, "//") {
		return fallbackHome
	}
	if workdir == "" || workdir == "." {
		return fallbackHome
	}
	// Resolve to absolute and verify the path exists.
	abs, err := filepath.Abs(workdir)
	if err != nil {
		return fallbackHome
	}
	if _, err := os.Stat(abs); err != nil {
		return fallbackHome
	}
	return abs
}

// userHomeFromConfig derives the real user's home directory from the
// claude_config_dir path (e.g. C:\Users\Jakeb\.claude -> C:\Users\Jakeb).
// Falls back to os.UserHomeDir() if claudeConfigDir is empty.
func userHomeFromConfig(claudeConfigDir string) string {
	if claudeConfigDir != "" {
		parent := filepath.Dir(claudeConfigDir)
		if _, err := os.Stat(parent); err == nil {
			return parent
		}
	}
	home, _ := os.UserHomeDir()
	return home
}

func (m *Manager) Start(requestID, sessionID, command, workdir string, env map[string]string) (string, error) {
	if sessionID == "" {
		sessionID = uuid.New().String()
	}
	workdir = sanitizeWorkdir(workdir, userHomeFromConfig(m.claudeConfigDir))

	m.logger.Info("starting session",
		"sessionId", sessionID,
		"requestId", requestID,
		"command", command,
		"workdir", workdir,
	)
	if m.debugLog != nil {
		m.debugLog.Info("session_start", "Session starting", map[string]any{
			"sessionId": sessionID,
			"command":   command,
			"workdir":   workdir,
		})
	}

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
		if m.debugLog != nil {
			m.debugLog.Info("session_exit", "Session exited", map[string]any{
				"sessionId": sid,
				"exitCode":  exitCode,
			})
		}
		m.registry.Remove(sid)

		convID := findClaudeConversationID(m.claudeConfigDir, workdir)
		if convID != "" {
			m.logger.Info("resolved claude conversation ID", "sessionId", sid, "conversationId", convID)
		}

		if exitErr != nil {
			msg := sessionCrashedMsg{
				Type:                 "session_crashed",
				SessionID:            sid,
				Error:                exitErr.Error(),
				ClaudeConversationID: convID,
			}
			if err := m.messenger.SendJSON(msg); err != nil {
				m.logger.Warn("failed to send session_crashed", "err", err)
			}
			return
		}

		code := exitCode
		msg := sessionStoppedMsg{
			Type:                 "session_stopped",
			SessionID:            sid,
			ExitCode:             &code,
			ClaudeConversationID: convID,
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

	// spawnPTY blocks until tier detection completes (ConPTY probe can take
	// 40+ seconds as LocalSystem). Run it in a goroutine so Start() returns
	// immediately and the WebSocket read loop is not blocked.
	go func() {
		m.logger.Info("manager: calling spawnPTY", "sessionId", sessionID, "command", command, "workdir", workdir)
		handle, pid, err := spawnPTY(m.ctx, sessionID, command, workdir, m.mergeEnv(env), outputFn, nil, exitFn)
		m.logger.Info("manager: spawnPTY returned", "sessionId", sessionID, "pid", pid, "err", err)
		if err != nil {
			m.logger.Error("spawnPTY failed", "sessionId", sessionID, "command", command, "workdir", workdir, "err", err)
			m.registry.Remove(sessionID)
			_ = m.messenger.SendJSON(sessionCrashedMsg{
				Type:      "session_crashed",
				SessionID: sessionID,
				Error:     err.Error(),
			})
			return
		}
		// Update placeholder with real PID and PTY handle.
		placeholder.PID = pid
		placeholder.ptySession = handle
	}()

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
	workdir = sanitizeWorkdir(workdir, userHomeFromConfig(m.claudeConfigDir))

	exitCh := make(chan int, 1)

	m.logger.Info("starting session with local output",
		"sessionId", sessionID,
		"requestId", requestID,
		"command", command,
		"workdir", workdir,
	)

	outputFn := func(sid, data string) {
		m.logger.Info("session_output chunk", "sessionId", sid, "bytes", len(data))
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

	handle, pid, err := spawnPTY(m.ctx, sessionID, command, workdir, m.mergeEnv(env), outputFn, localFn, exitFn)
	if err != nil {
		m.registry.Remove(sessionID)
		// earlyStarted was already sent — notify the cloud so the DB record is cleaned up.
		_ = m.messenger.SendJSON(sessionCrashedMsg{
			Type:      "session_crashed",
			SessionID: sessionID,
			Error:     err.Error(),
		})
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
