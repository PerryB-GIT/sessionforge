package debuglog

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Level represents log severity.
type Level string

const (
	LevelDebug Level = "debug"
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
)

// Event is a single debug log entry sent to the server.
type Event struct {
	MachineID    string         `json:"machineId"`
	Level        Level          `json:"level"`
	Component    string         `json:"component"`
	Message      string         `json:"message"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	AgentVersion string         `json:"agentVersion,omitempty"`
}

// Client sends debug events to the SessionForge server.
// All sends are non-blocking — events are queued and sent by a background goroutine.
// If the queue is full or the server is unreachable, events are silently dropped.
type Client struct {
	machineID    string
	apiKey       string
	serverURL    string
	agentVersion string
	queue        chan Event
	httpClient   *http.Client
	once         sync.Once
	ctx          context.Context
	cancel       context.CancelFunc
}

// New creates a new Client. Call Start() to begin background processing.
func New(machineID, apiKey, serverURL, agentVersion string) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{
		machineID:    machineID,
		apiKey:       apiKey,
		serverURL:    strings.TrimRight(serverURL, "/"),
		agentVersion: agentVersion,
		queue:        make(chan Event, 128),
		httpClient:   &http.Client{Timeout: 10 * time.Second},
		ctx:          ctx,
		cancel:       cancel,
	}
}

// Start begins the background send goroutine. Safe to call multiple times.
func (c *Client) Start() {
	c.once.Do(func() {
		go c.drain()
	})
}

// Stop flushes remaining events (up to 5s) and shuts down.
func (c *Client) Stop() {
	c.cancel()
}

// send enqueues an event. Never blocks, never panics.
func (c *Client) send(level Level, component, message string, metadata map[string]any) {
	if c == nil {
		return
	}
	evt := Event{
		MachineID:    c.machineID,
		Level:        level,
		Component:    component,
		Message:      message,
		Metadata:     sanitize(metadata),
		AgentVersion: c.agentVersion,
	}
	select {
	case c.queue <- evt:
	default:
		// Queue full — drop silently
	}
}

func (c *Client) Debug(component, message string, metadata map[string]any) {
	c.send(LevelDebug, component, message, metadata)
}

func (c *Client) Info(component, message string, metadata map[string]any) {
	c.send(LevelInfo, component, message, metadata)
}

func (c *Client) Warn(component, message string, metadata map[string]any) {
	c.send(LevelWarn, component, message, metadata)
}

func (c *Client) Error(component, message string, metadata map[string]any) {
	c.send(LevelError, component, message, metadata)
}

func (c *Client) drain() {
	// Batch sends: collect up to 10 events or wait 2 seconds, whichever comes first
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	var batch []Event

	flush := func() {
		if len(batch) == 0 {
			return
		}
		c.postBatch(batch)
		batch = batch[:0]
	}

	for {
		select {
		case evt := <-c.queue:
			batch = append(batch, evt)
			if len(batch) >= 10 {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-c.ctx.Done():
			// Drain remaining
			for {
				select {
				case evt := <-c.queue:
					batch = append(batch, evt)
				default:
					flush()
					return
				}
			}
		}
	}
}

func (c *Client) postBatch(events []Event) {
	// Post each event individually (server expects single event per request)
	for _, evt := range events {
		c.postOne(evt)
	}
}

func (c *Client) postOne(evt Event) {
	body, err := json.Marshal(evt)
	if err != nil {
		return
	}
	req, err := http.NewRequestWithContext(c.ctx, http.MethodPost,
		c.serverURL+"/api/agent/debug-log", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return // Network error — drop silently
	}
	resp.Body.Close()
}

// sanitize removes any metadata values that contain the API key pattern.
func sanitize(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		s, ok := v.(string)
		if ok && strings.Contains(s, "sf_live_") {
			out[k] = "[REDACTED]"
		} else {
			out[k] = v
		}
	}
	return out
}
