package connection

import (
	"encoding/json"
	"log/slog"
)

// SessionManager is the interface the handler uses to control sessions.
// Implemented by session.Manager.
type SessionManager interface {
	Start(requestID, command, workdir string, env map[string]string) (string, error)
	Stop(sessionID string, force bool) error
	Pause(sessionID string) error
	Resume(sessionID string) error
	WriteInput(sessionID, data string) error
	Resize(sessionID string, cols, rows uint16) error
}

// --- Incoming message structs (CloudToAgentMessage) ---

type startSessionMsg struct {
	Type      string            `json:"type"`
	RequestID string            `json:"requestId"`
	Command   string            `json:"command"`
	Workdir   string            `json:"workdir"`
	Env       map[string]string `json:"env"`
}

type stopSessionMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Force     bool   `json:"force"`
}

type pauseSessionMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
}

type resumeSessionMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
}

type sessionInputMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Data      string `json:"data"` // base64
}

type resizeMsg struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Cols      uint16 `json:"cols"`
	Rows      uint16 `json:"rows"`
}

// Handler dispatches CloudToAgentMessages to the session manager or client.
type Handler struct {
	sessions SessionManager
	client   *Client
	logger   *slog.Logger
}

// NewHandler creates a Handler.
func NewHandler(sessions SessionManager, client *Client, logger *slog.Logger) *Handler {
	return &Handler{
		sessions: sessions,
		client:   client,
		logger:   logger,
	}
}

// Handle processes one CloudToAgentMessage. It is called from the Client read loop.
func (h *Handler) Handle(msg CloudMessage) {
	h.logger.Debug("handler: received message", "type", msg.Type)

	switch msg.Type {
	case "start_session":
		h.handleStartSession(msg.Raw)

	case "stop_session":
		h.handleStopSession(msg.Raw)

	case "pause_session":
		h.handlePauseSession(msg.Raw)

	case "resume_session":
		h.handleResumeSession(msg.Raw)

	case "session_input":
		h.handleSessionInput(msg.Raw)

	case "resize":
		h.handleResize(msg.Raw)

	case "ping":
		h.handlePing()

	default:
		h.logger.Warn("handler: unknown message type", "type", msg.Type)
	}
}

func (h *Handler) handleStartSession(raw []byte) {
	var m startSessionMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		h.logger.Error("handler: parse start_session", "err", err)
		return
	}
	if m.Command == "" {
		m.Command = "claude"
	}
	if m.Workdir == "" {
		m.Workdir = "."
	}

	h.logger.Info("handler: start_session",
		"requestId", m.RequestID,
		"command", m.Command,
		"workdir", m.Workdir,
	)

	sessionID, err := h.sessions.Start(m.RequestID, m.Command, m.Workdir, m.Env)
	if err != nil {
		h.logger.Error("handler: start_session failed", "err", err, "requestId", m.RequestID)
		// Send a crash notification so the cloud knows the request failed.
		_ = h.client.SendJSON(map[string]any{
			"type":      "session_crashed",
			"sessionId": m.RequestID,
			"error":     err.Error(),
		})
		return
	}

	h.logger.Info("handler: session started", "sessionId", sessionID)
}

func (h *Handler) handleStopSession(raw []byte) {
	var m stopSessionMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		h.logger.Error("handler: parse stop_session", "err", err)
		return
	}
	h.logger.Info("handler: stop_session", "sessionId", m.SessionID, "force", m.Force)
	if err := h.sessions.Stop(m.SessionID, m.Force); err != nil {
		h.logger.Warn("handler: stop_session failed", "sessionId", m.SessionID, "err", err)
	}
}

func (h *Handler) handlePauseSession(raw []byte) {
	var m pauseSessionMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		h.logger.Error("handler: parse pause_session", "err", err)
		return
	}
	h.logger.Info("handler: pause_session", "sessionId", m.SessionID)
	if err := h.sessions.Pause(m.SessionID); err != nil {
		h.logger.Warn("handler: pause_session failed", "sessionId", m.SessionID, "err", err)
	}
}

func (h *Handler) handleResumeSession(raw []byte) {
	var m resumeSessionMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		h.logger.Error("handler: parse resume_session", "err", err)
		return
	}
	h.logger.Info("handler: resume_session", "sessionId", m.SessionID)
	if err := h.sessions.Resume(m.SessionID); err != nil {
		h.logger.Warn("handler: resume_session failed", "sessionId", m.SessionID, "err", err)
	}
}

func (h *Handler) handleSessionInput(raw []byte) {
	var m sessionInputMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		h.logger.Error("handler: parse session_input", "err", err)
		return
	}
	if err := h.sessions.WriteInput(m.SessionID, m.Data); err != nil {
		h.logger.Warn("handler: session_input write failed", "sessionId", m.SessionID, "err", err)
	}
}

func (h *Handler) handleResize(raw []byte) {
	var m resizeMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		h.logger.Error("handler: parse resize", "err", err)
		return
	}
	h.logger.Debug("handler: resize", "sessionId", m.SessionID, "cols", m.Cols, "rows", m.Rows)
	if err := h.sessions.Resize(m.SessionID, m.Cols, m.Rows); err != nil {
		h.logger.Warn("handler: resize failed", "sessionId", m.SessionID, "err", err)
	}
}

// handlePing responds to a server ping with an immediate heartbeat.
// The cloud uses this to verify the agent is alive.
func (h *Handler) handlePing() {
	h.logger.Debug("handler: ping received")
	// Respond with a minimal heartbeat so the cloud gets a pong-equivalent.
	_ = h.client.SendJSON(map[string]string{
		"type": "heartbeat",
	})
}
