# SessionForge Agent Installation Guide

The **SessionForge Agent** is a lightweight background process that runs on your machine and maintains a persistent WebSocket connection to the SessionForge cloud.  It receives commands (start/stop sessions, terminal input) and streams output back in real time.

---

## Quick Install (Recommended)

The one-liner shown in the dashboard setup wizard is the fastest way to install:

**Linux / macOS:**
```bash
curl -fsSL https://install.sessionforge.dev | bash -s -- --key sf_live_YOUR_API_KEY
```

**Windows (PowerShell, run as Administrator):**
```powershell
irm https://install.sessionforge.dev/win | iex -ApiKey sf_live_YOUR_API_KEY
```

Replace `sf_live_YOUR_API_KEY` with the key shown in the **Add Machine** wizard on the dashboard.

---

## Linux

### Supported distributions

- Ubuntu 20.04+
- Debian 11+
- RHEL / CentOS 8+
- Fedora 36+
- Arch Linux

### Prerequisites

- `curl` or `wget`
- `systemd` (for running as a service)
- Port 443 outbound to `sessionforge.dev` must be open

### Step-by-step installation

```bash
# 1. Download the installer
curl -fsSL https://install.sessionforge.dev -o sf-install.sh

# 2. Make executable and run with your key
chmod +x sf-install.sh
sudo ./sf-install.sh --key sf_live_YOUR_API_KEY

# 3. Verify the agent is running
sudo systemctl status sessionforge-agent
```

### Manual installation (no systemd)

```bash
# Download the binary directly
curl -fsSL https://releases.sessionforge.dev/latest/linux-amd64/sf-agent -o sf-agent
chmod +x sf-agent

# Run with your API key
SF_API_KEY=sf_live_YOUR_API_KEY ./sf-agent
```

### Systemd unit file

The installer creates `/etc/systemd/system/sessionforge-agent.service`:

```ini
[Unit]
Description=SessionForge Agent
After=network.target
Wants=network.target

[Service]
Type=simple
User=sessionforge
Environment=SF_API_KEY=sf_live_YOUR_API_KEY
ExecStart=/usr/local/bin/sf-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Useful commands

```bash
sudo systemctl start sessionforge-agent      # Start
sudo systemctl stop sessionforge-agent       # Stop
sudo systemctl restart sessionforge-agent    # Restart
sudo systemctl enable sessionforge-agent     # Enable at boot
sudo journalctl -u sessionforge-agent -f     # Tail logs
```

---

## macOS

### Supported versions

- macOS 12 Monterey+
- macOS 13 Ventura+
- macOS 14 Sonoma+

### Architecture

Both Apple Silicon (arm64) and Intel (x86_64) are supported. The installer detects your architecture automatically.

### Step-by-step installation

```bash
# 1. Download the installer
curl -fsSL https://install.sessionforge.dev -o sf-install.sh

# 2. Run with your key (no sudo required)
bash sf-install.sh --key sf_live_YOUR_API_KEY

# 3. The agent is configured as a launchd daemon and starts automatically
launchctl list | grep sessionforge
```

### Manual installation

```bash
# Download the binary
curl -fsSL https://releases.sessionforge.dev/latest/darwin-arm64/sf-agent -o sf-agent
chmod +x sf-agent
sudo xattr -rd com.apple.quarantine sf-agent   # Remove Gatekeeper quarantine

# Run
SF_API_KEY=sf_live_YOUR_API_KEY ./sf-agent
```

### launchd plist

The installer places a plist at `~/Library/LaunchAgents/dev.sessionforge.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.sessionforge.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/sf-agent</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SF_API_KEY</key>
    <string>sf_live_YOUR_API_KEY</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

### Useful commands

```bash
launchctl load   ~/Library/LaunchAgents/dev.sessionforge.agent.plist    # Start
launchctl unload ~/Library/LaunchAgents/dev.sessionforge.agent.plist    # Stop
log stream --predicate 'subsystem == "dev.sessionforge.agent"'           # Logs
```

---

## Windows

### Supported versions

- Windows 10 (version 1903+)
- Windows 11
- Windows Server 2019+
- Windows Server 2022+

### Prerequisites

- PowerShell 5.1+ (included in Windows 10) or PowerShell 7+
- .NET 6 Runtime (the installer will prompt to download if missing)

### Step-by-step installation

1. Open **PowerShell as Administrator**
2. Run the one-liner from the dashboard, or:

```powershell
# Download the installer script
Invoke-WebRequest -Uri https://install.sessionforge.dev/win -OutFile sf-install.ps1

# Run the installer
.\sf-install.ps1 -ApiKey sf_live_YOUR_API_KEY
```

The installer will:
- Extract the `sf-agent.exe` binary to `C:\Program Files\SessionForge\`
- Create a Windows Service named **SessionForgeAgent**
- Start the service and configure it to start on boot

### Verify the service

```powershell
Get-Service -Name SessionForgeAgent
# Status should be "Running"
```

### Manage the service

```powershell
Start-Service SessionForgeAgent
Stop-Service SessionForgeAgent
Restart-Service SessionForgeAgent

# View logs in Event Viewer:
Get-EventLog -LogName Application -Source SessionForgeAgent -Newest 50
```

### Manual installation (no service)

```powershell
# Download the binary
Invoke-WebRequest -Uri https://releases.sessionforge.dev/latest/windows-amd64/sf-agent.exe -OutFile sf-agent.exe

# Run directly
$env:SF_API_KEY = "sf_live_YOUR_API_KEY"
.\sf-agent.exe
```

---

## Configuration

All configuration is done via environment variables (the installer sets these automatically):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SF_API_KEY` | Yes | — | Your machine's API key |
| `SF_CLOUD_URL` | No | `wss://sessionforge.dev/api/ws/agent` | WebSocket endpoint |
| `SF_LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `SF_HEARTBEAT_INTERVAL` | No | `30` | Heartbeat interval in seconds |
| `SF_MAX_SESSIONS` | No | `10` | Maximum concurrent sessions |

---

## Updating the Agent

The agent checks for updates automatically and downloads new versions in the background.  You can also update manually:

**Linux / macOS:**
```bash
sudo sf-agent update
```

**Windows:**
```powershell
sf-agent.exe update
```

---

## Uninstalling the Agent

**Linux:**
```bash
sudo systemctl stop sessionforge-agent && sudo systemctl disable sessionforge-agent
sudo rm /etc/systemd/system/sessionforge-agent.service
sudo rm /usr/local/bin/sf-agent
```

**macOS:**
```bash
launchctl unload ~/Library/LaunchAgents/dev.sessionforge.agent.plist
rm ~/Library/LaunchAgents/dev.sessionforge.agent.plist
sudo rm /usr/local/bin/sf-agent
```

**Windows:**
```powershell
Stop-Service SessionForgeAgent
Remove-Service -Name SessionForgeAgent
Remove-Item "C:\Program Files\SessionForge\" -Recurse
```

---

## Security Notes

- The agent runs as a **non-root user** on Linux (`sessionforge` system account created by the installer)
- On macOS, the agent runs as the **current user** (no root required)
- On Windows, the agent runs as the **LocalSystem** account by default (can be changed)
- All communication uses **TLS 1.3** with certificate pinning
- The API key is stored in the system's keyring / service manager — never in plain text files on disk
- Rotate your API key at any time via **Settings > API Keys** on the dashboard
