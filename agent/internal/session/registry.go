// Package session manages the lifecycle of PTY-based terminal sessions.
package session

import (
	"fmt"
	"sync"
	"time"
)

// Session represents a single running terminal session.
type Session struct {
	ID          string
	PID         int
	ProcessName string
	Workdir     string
	StartedAt   time.Time
	Command     string

	// ptySession is the underlying OS-specific PTY handle.
	ptySession *ptyHandle
}

// Registry is a thread-safe in-memory store of active sessions.
type Registry struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewRegistry creates an empty Registry.
func NewRegistry() *Registry {
	return &Registry{
		sessions: make(map[string]*Session),
	}
}

// Add inserts a session into the registry.
func (r *Registry) Add(s *Session) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[s.ID] = s
}

// Get retrieves a session by ID. Returns an error if not found.
func (r *Registry) Get(id string) (*Session, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.sessions[id]
	if !ok {
		return nil, fmt.Errorf("session %s not found", id)
	}
	return s, nil
}

// Remove deletes a session from the registry.
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, id)
}

// GetAll returns a snapshot of all active sessions.
func (r *Registry) GetAll() []*Session {
	r.mu.RLock()
	defer r.mu.RUnlock()
	list := make([]*Session, 0, len(r.sessions))
	for _, s := range r.sessions {
		list = append(list, s)
	}
	return list
}

// Count returns the number of active sessions.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.sessions)
}
