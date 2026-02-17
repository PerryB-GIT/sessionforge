// Package connection manages the WebSocket connection to the SessionForge cloud.
package connection

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sessionforge/agent/internal/config"
	"github.com/sessionforge/agent/internal/system"
)

const (
	// maxBackoff is the ceiling for exponential reconnect delay.
	maxBackoff = 60 * time.Second
	// writeTimeout limits how long a write may block.
	writeTimeout = 10 * time.Second
	// pingInterval is the WebSocket-level keep-alive.
	pingInterval = 20 * time.Second
)

// registerMsg is sent once on connection to identify this agent to the cloud.
type registerMsg struct {
	Type      string `json:"type"`
	MachineID string `json:"machineId"`
	Name      string `json:"name"`
	OS        string `json:"os"`
	Hostname  string `json:"hostname"`
	Version   string `json:"version"`
}

// CloudMessage is the minimal envelope used to route incoming messages.
type CloudMessage struct {
	Type string `json:"type"`
	// Raw preserves the full JSON so the handler can decode the concrete type.
	Raw []byte `json:"-"`
}

// MessageHandler is called with each cloud-to-agent message.
type MessageHandler func(msg CloudMessage)

// Client manages a persistent WebSocket connection with exponential backoff reconnection.
type Client struct {
	cfg     *config.Config
	version string
	handler MessageHandler
	logger  *slog.Logger

	mu   sync.Mutex
	conn *websocket.Conn

	sendCh chan []byte
	stopCh chan struct{}
	doneCh chan struct{}
}

// NewClient creates a Client. Call Run() to connect.
func NewClient(cfg *config.Config, version string, handler MessageHandler, logger *slog.Logger) *Client {
	return &Client{
		cfg:     cfg,
		version: version,
		handler: handler,
		logger:  logger,
		sendCh:  make(chan []byte, 256),
		stopCh:  make(chan struct{}),
		doneCh:  make(chan struct{}),
	}
}

// Run connects to the cloud and maintains the connection until ctx is cancelled.
// It implements exponential backoff: 1s, 2s, 4s … capped at 60s.
func (c *Client) Run(ctx context.Context) {
	defer close(c.doneCh)

	attempt := 0
	for {
		select {
		case <-ctx.Done():
			c.logger.Info("connection: context cancelled, stopping")
			return
		default:
		}

		delay := backoffDelay(attempt)
		if attempt > 0 {
			c.logger.Info("connection: reconnecting", "attempt", attempt, "delay", delay)
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return
			}
		}

		if err := c.connect(ctx); err != nil {
			c.logger.Warn("connection: failed", "err", err, "attempt", attempt)
			attempt++
			continue
		}

		// Successful connection; reset backoff.
		attempt = 0
	}
}

// connect opens one WebSocket session, handles messages, and returns when disconnected.
func (c *Client) connect(ctx context.Context) error {
	wsURL := c.cfg.WebSocketURL()
	c.logger.Info("connection: connecting", "url", wsURL)

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}
	conn, resp, err := dialer.DialContext(ctx, wsURL, http.Header{
		"User-Agent": []string{"SessionForge-Agent/" + c.version},
	})
	if err != nil {
		if resp != nil {
			return fmt.Errorf("websocket dial (HTTP %d): %w", resp.StatusCode, err)
		}
		return fmt.Errorf("websocket dial: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	c.logger.Info("connection: connected")

	// Send registration message immediately.
	if err := c.sendRegister(); err != nil {
		conn.Close()
		return fmt.Errorf("register: %w", err)
	}

	// Goroutine for writes.
	writeErrCh := make(chan error, 1)
	go c.writeLoop(ctx, conn, writeErrCh)

	// Read loop (blocks until disconnect or ctx cancel).
	readErr := c.readLoop(ctx, conn)

	// Signal write loop to stop.
	conn.Close()

	select {
	case writeErr := <-writeErrCh:
		if writeErr != nil && readErr == nil {
			return writeErr
		}
	case <-time.After(2 * time.Second):
	}

	c.mu.Lock()
	c.conn = nil
	c.mu.Unlock()

	return readErr
}

// readLoop reads messages from the server and dispatches them to the handler.
func (c *Client) readLoop(ctx context.Context, conn *websocket.Conn) error {
	conn.SetReadDeadline(time.Now().Add(pingInterval * 2))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pingInterval * 2))
		return nil
	})

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		_, raw, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				c.logger.Info("connection: server closed connection gracefully")
				return nil
			}
			return fmt.Errorf("read: %w", err)
		}

		// Reset read deadline on each message.
		conn.SetReadDeadline(time.Now().Add(pingInterval * 2))

		// Parse envelope to extract type.
		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			c.logger.Warn("connection: malformed message", "err", err)
			continue
		}

		c.handler(CloudMessage{Type: envelope.Type, Raw: raw})
	}
}

// writeLoop drains sendCh and sends pings on a ticker.
func (c *Client) writeLoop(ctx context.Context, conn *websocket.Conn, errCh chan<- error) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	send := func(msgType int, data []byte) error {
		conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		return conn.WriteMessage(msgType, data)
	}

	for {
		select {
		case <-ctx.Done():
			// Send close frame.
			_ = send(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "agent shutdown"))
			errCh <- nil
			return

		case data := <-c.sendCh:
			if err := send(websocket.TextMessage, data); err != nil {
				errCh <- fmt.Errorf("write: %w", err)
				return
			}

		case <-ticker.C:
			if err := send(websocket.PingMessage, nil); err != nil {
				errCh <- fmt.Errorf("ping: %w", err)
				return
			}
		}
	}
}

// SendJSON serialises v to JSON and queues it for delivery.
// Non-blocking: if the send buffer is full, the message is dropped with a warning.
func (c *Client) SendJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	select {
	case c.sendCh <- data:
		return nil
	default:
		c.logger.Warn("connection: send buffer full, dropping message")
		return fmt.Errorf("send buffer full")
	}
}

// sendRegister sends the 'register' message over the connection synchronously.
func (c *Client) sendRegister() error {
	msg := registerMsg{
		Type:      "register",
		MachineID: c.cfg.MachineID,
		Name:      c.cfg.MachineName,
		OS:        system.GetOS(),
		Hostname:  system.GetHostname(),
		Version:   c.version,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("not connected")
	}
	conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	return conn.WriteMessage(websocket.TextMessage, data)
}

// Wait blocks until the client's Run goroutine exits.
func (c *Client) Wait() {
	<-c.doneCh
}

// backoffDelay computes exponential backoff capped at maxBackoff.
// attempt 0 → 0, attempt 1 → 1s, attempt 2 → 2s, attempt 3 → 4s, …
func backoffDelay(attempt int) time.Duration {
	if attempt == 0 {
		return 0
	}
	secs := math.Pow(2, float64(attempt-1))
	d := time.Duration(secs) * time.Second
	if d > maxBackoff {
		d = maxBackoff
	}
	return d
}
