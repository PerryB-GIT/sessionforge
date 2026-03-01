# SessionForge Agent

The SessionForge agent runs on your machine and connects it to your SessionForge dashboard, enabling real-time remote access to Claude Code sessions from any browser.

## Install

**Linux / macOS:**
```sh
curl -sSL https://sessionforge.dev/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://sessionforge.dev/install.ps1 | iex
```

## Quick Start

```sh
# 1. Authenticate with your API key (from sessionforge.dev/dashboard/api-keys)
sessionforge auth login --key sf_live_xxxxx

# 2. Install as a system service (starts on boot)
sessionforge service install

# 3. Verify the connection
sessionforge status
```

## Commands

| Command | Description |
|---------|-------------|
| `sessionforge auth login --key <key>` | Authenticate with a SessionForge API key |
| `sessionforge auth logout` | Remove stored credentials |
| `sessionforge service install` | Install and start the background service |
| `sessionforge service uninstall` | Stop and remove the background service |
| `sessionforge service start` | Start the service manually |
| `sessionforge service stop` | Stop the service |
| `sessionforge session list` | List active sessions on this machine |
| `sessionforge status` | Show connection status and machine info |
| `sessionforge update` | Update the agent to the latest version |

## Build from Source

Requires Go 1.22+.

```sh
git clone https://github.com/sessionforge/agent
cd agent
go build -o sessionforge ./cmd/sessionforge
```

## License

MIT — see [LICENSE](LICENSE).
