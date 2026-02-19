// Package config manages the SessionForge agent configuration file.
// Config is stored at ~/.sessionforge/config.toml
package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

const (
	DefaultServerURL = "https://sessionforge.dev"
	DefaultLogLevel  = "info"
	configDir        = ".sessionforge"
	configFile       = "config.toml"
)

// Config holds all agent configuration values.
type Config struct {
	// ServerURL is the base URL of the SessionForge cloud server.
	ServerURL string `toml:"server_url"`
	// APIKey is the agent API key used to authenticate with the server.
	APIKey string `toml:"api_key"`
	// MachineID is a persistent UUID identifying this machine.
	MachineID string `toml:"machine_id"`
	// MachineName is a human-readable label for this machine.
	MachineName string `toml:"machine_name"`
	// LogLevel controls logging verbosity: debug, info, warn, error.
	LogLevel string `toml:"log_level"`
}

// DefaultConfig returns a Config populated with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		ServerURL: DefaultServerURL,
		LogLevel:  DefaultLogLevel,
	}
}

// ConfigDir returns the path to the ~/.sessionforge directory.
func ConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, configDir), nil
}

// ConfigPath returns the full path to the config file.
func ConfigPath() (string, error) {
	dir, err := ConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, configFile), nil
}

// Load reads the config file from disk. If the file does not exist, it returns
// the default configuration without error.
func Load() (*Config, error) {
	path, err := ConfigPath()
	if err != nil {
		return nil, err
	}

	cfg := DefaultConfig()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		// No config file yet; return defaults.
		return cfg, nil
	}

	if _, err := toml.DecodeFile(path, cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file %s: %w", path, err)
	}

	return cfg, nil
}

// Save writes the config to disk, creating the directory if needed.
func Save(cfg *Config) error {
	dir, err := ConfigDir()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("failed to create config directory %s: %w", dir, err)
	}

	path, err := ConfigPath()
	if err != nil {
		return err
	}

	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("failed to open config file %s for writing: %w", path, err)
	}
	defer f.Close()

	enc := toml.NewEncoder(f)
	if err := enc.Encode(cfg); err != nil {
		return fmt.Errorf("failed to encode config: %w", err)
	}

	return nil
}

// IsConfigured returns true if the minimum required fields are present.
func (c *Config) IsConfigured() bool {
	return c.APIKey != "" && c.MachineID != ""
}

// WebSocketURL constructs the WebSocket endpoint URL from ServerURL and APIKey.
func (c *Config) WebSocketURL() string {
	base := c.ServerURL
	// Replace https:// with wss:// and http:// with ws://
	switch {
	case len(base) >= 8 && base[:8] == "https://":
		base = "wss://" + base[8:]
	case len(base) >= 7 && base[:7] == "http://":
		base = "ws://" + base[7:]
	}
	return base + "/api/ws/agent?key=" + c.APIKey
}
