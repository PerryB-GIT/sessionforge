# Getting Started with SessionForge

SessionForge lets you remotely start, monitor, and stop AI agent sessions (like Claude) running on any machine — from a single browser dashboard.

---

## Prerequisites

- A modern browser (Chrome, Edge, Firefox, Safari)
- At least one machine (Linux, macOS, or Windows) where you want to run sessions
- A SessionForge account (free tier available)

---

## 1. Create an Account

1. Go to [sessionforge.dev/signup](https://sessionforge.dev/signup)
2. Enter your name, email address, and a strong password (min 8 chars, mixed case, number, special char)
3. Click **Create Account**
4. Check your inbox for a verification email and click the confirmation link
5. You will be redirected to your dashboard

---

## 2. Connect Your First Machine

Your machine runs the **SessionForge Agent** — a lightweight background process that connects to the cloud, receives commands, and spawns terminal sessions.

### Step 1: Open the Setup Wizard

1. On your dashboard, click **Machines** in the left sidebar
2. Click **Add Machine** (or **Connect Agent** if no machines exist yet)
3. The setup wizard will display a one-line install command that includes your unique API key

### Step 2: Run the Install Command on Your Machine

Copy the install command and run it in a terminal on the target machine.

**Linux / macOS:**
```bash
curl -fsSL https://install.sessionforge.dev | bash -s -- --key sf_live_YOUR_API_KEY
```

**Windows (PowerShell):**
```powershell
irm https://install.sessionforge.dev/win | iex -ApiKey sf_live_YOUR_API_KEY
```

The script will:
- Download the latest SessionForge Agent binary
- Configure it with your API key
- Register the machine with the cloud
- Start the agent as a background service

### Step 3: Verify the Connection

Within 30 seconds of running the install command, your machine should appear in the Machines grid with a green **Online** status indicator.

If it does not appear, see [Troubleshooting](./troubleshooting.md).

---

## 3. Start Your First Session

1. Click on the machine card in the Machines grid
2. Click the **Sessions** tab
3. Click **Start Session**
4. In the dialog, select a command (defaults to `claude`)
5. Optionally set a working directory
6. Click **Start**

A terminal window will open in your browser, connected to the remote machine. You can interact with it in real time.

---

## 4. Monitor and Manage Sessions

From the **Sessions** tab on any machine:
- **Active sessions** are shown with a green dot and live CPU/memory metrics
- **Click a session** to open its terminal
- **Stop a session** by clicking the red Stop button or from the session's detail page
- **Session history** is available for the duration your plan allows (1 day on Free, 30 days on Pro)

---

## 5. Invite Team Members (Pro / Team Plans)

1. Go to **Settings > Team**
2. Click **Invite Member**
3. Enter their email address and select a role (Admin, Member, Viewer)
4. They will receive an email invitation

---

## Plan Comparison

| Feature                  | Free   | Pro    | Team    | Enterprise |
|--------------------------|--------|--------|---------|------------|
| Machines                 | 1      | 5      | 20      | Unlimited  |
| Concurrent sessions      | 3      | Unlimited | Unlimited | Unlimited |
| Session history          | 1 day  | 30 days | 90 days | 365 days  |
| API access               | No     | Yes    | Yes     | Yes        |
| Webhooks                 | No     | Yes    | Yes     | Yes        |
| SSO                      | No     | No     | No      | Yes        |
| Price / month            | Free   | $19    | $49     | $199       |

---

## Next Steps

- [Agent Installation Guide](./agent-install.md) — Detailed per-OS setup instructions
- [API Reference](./api-reference.md) — Automate machine and session management
- [Troubleshooting](./troubleshooting.md) — Fix common issues
