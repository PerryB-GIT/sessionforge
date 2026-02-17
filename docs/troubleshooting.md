# Troubleshooting

This guide covers the most common issues encountered with SessionForge and their fixes.

---

## Agent Issues

### Machine does not appear in the dashboard after install

**Symptoms:** You ran the install command successfully but the machine never shows up in the Machines grid (or it shows as Offline).

**Checks:**

1. **Is the agent process running?**

   ```bash
   # Linux
   sudo systemctl status sessionforge-agent
   journalctl -u sessionforge-agent -n 50

   # macOS
   launchctl list | grep sessionforge
   cat ~/Library/Logs/sessionforge-agent.log

   # Windows
   Get-Service SessionForgeAgent
   Get-EventLog -LogName Application -Source SessionForgeAgent -Newest 20
   ```

2. **Is port 443 outbound open?**

   ```bash
   curl -v wss://sessionforge.dev/api/ws/agent 2>&1 | head -20
   # Should show "101 Switching Protocols" if the path is open
   ```

   If blocked, work with your network admin to allow outbound TCP 443 to `sessionforge.dev`.

3. **Is the API key correct?**

   The key in the service configuration must start with `sf_live_`.  Retrieve the correct key from **Settings > API Keys**.

   ```bash
   # Linux — view current key
   sudo systemctl cat sessionforge-agent | grep SF_API_KEY
   ```

4. **Has the API key been revoked?**

   Go to **Settings > API Keys** and verify the key is listed and active.

**Fix:** Restart the agent after correcting any configuration issues.

```bash
sudo systemctl restart sessionforge-agent
```

---

### Machine shows as Offline even though the agent is running

**Symptoms:** The agent process is running but the dashboard shows the machine as Offline.

**Cause:** The agent is not successfully connecting to the WebSocket endpoint or the heartbeat is not reaching the cloud.

**Checks:**

1. **Check agent logs for connection errors:**
   ```bash
   journalctl -u sessionforge-agent -n 100 | grep -i "error\|failed\|refused"
   ```

2. **Verify system clock is correct (TLS requires accurate time):**
   ```bash
   date
   # On Linux: sudo timedatectl set-ntp true
   # On macOS: sudo sntp -sS time.apple.com
   ```

3. **Check for DNS resolution failures:**
   ```bash
   nslookup sessionforge.dev
   ```

4. **Verify the agent version is current:**
   ```bash
   sf-agent --version
   sf-agent update
   ```

---

### Agent crashes immediately after starting

**Symptoms:** The service starts but exits with a non-zero code immediately.

**Checks:**

1. **View the exit code and error message:**
   ```bash
   journalctl -u sessionforge-agent -n 20 --no-pager
   ```

2. **Common exit codes:**

   | Exit code | Cause |
   |-----------|-------|
   | 1 | Missing or invalid `SF_API_KEY` |
   | 2 | Cannot connect to `sessionforge.dev` (network/DNS) |
   | 3 | API key revoked or expired |
   | 4 | Machine limit reached for the account's plan |
   | 127 | Binary not found in `PATH` |

---

## Session Issues

### Session fails to start / stays in "starting" state

**Symptoms:** You click Start Session and it hangs or shows an error.

**Checks:**

1. **Is the machine online?** A machine must show a green Online indicator before you can start a session.

2. **Is the command available on the remote machine?**
   ```bash
   # On the remote machine
   which claude      # or which bash, etc.
   ```

3. **Free plan session limit:** Free plans allow 3 concurrent sessions. Stop an existing session before starting a new one.

4. **Working directory does not exist:**
   Verify the `workdir` you specified exists on the remote machine.

---

### Terminal shows "Disconnected" or freezes

**Symptoms:** The terminal was working, then stopped responding.

**Causes and fixes:**

1. **Agent disconnected** — Check the Machines grid. If the machine shows as Offline, the agent has disconnected. Restart the agent on the remote machine.

2. **Browser WebSocket timeout** — Some corporate proxies terminate WebSocket connections after a period of inactivity. The agent sends ping/pong frames every 30 seconds to prevent this, but some proxies have shorter timeouts. Try connecting from a different network or using a VPN.

3. **Session process exited unexpectedly** — The underlying process (e.g. `claude`) may have crashed. Check the session status: if it shows "Crashed", the session output will include the last terminal lines before the crash.

---

### Session output is garbled / shows escape codes

**Symptoms:** Terminal output contains raw ANSI escape sequences like `^[[32m` instead of coloured text.

**Fix:** The terminal emulator in the dashboard interprets ANSI escape codes by default. If you see raw codes, the session was likely started with `TERM=dumb`.  Set the `TERM` environment variable when starting the session:

In the Start Session dialog, under **Environment Variables**, add:
```
TERM = xterm-256color
```

---

## Authentication Issues

### "Invalid credentials" on login even with correct password

1. Confirm you are using the correct email address (check for typos).
2. Check for trailing whitespace — copy-pasted passwords sometimes include it.
3. If you signed up with Google / GitHub OAuth, you do not have a password. Use the **Continue with Google** or **Continue with GitHub** button instead.
4. Use **Forgot Password** to reset your password if unsure.

---

### Email verification link expired

Verification links expire after 24 hours.

**Fix:** Go to the login page, attempt to log in, and look for a "Resend verification email" option.

---

### "Session expired" / Logged out unexpectedly

Sessions expire after 7 days of inactivity by default.

**Fix:** Log in again. If this happens frequently on an active account, check whether your browser is clearing cookies (e.g. private browsing mode, cookie blockers, or browser settings that clear cookies on exit).

---

## Billing Issues

### Stripe Checkout does not open

1. Disable ad blockers or browser extensions that block third-party redirects.
2. Ensure pop-up blocking is not preventing the Stripe page from loading.
3. Try a different browser.

---

### Plan did not upgrade after payment

1. Stripe webhooks may take up to 2 minutes to process. Refresh the billing page.
2. Check your email for a payment confirmation from Stripe.
3. If still not updated after 5 minutes, contact support at **support@sessionforge.dev** with your Stripe payment ID.

---

## Dashboard / UI Issues

### Dashboard is blank or shows a loading spinner forever

1. **Hard refresh:** `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (macOS)
2. **Clear browser cache and cookies** for `sessionforge.dev`
3. **Check browser console** for JavaScript errors (`F12` → Console tab)
4. **Try a different browser** to rule out browser-specific issues

---

### "Something went wrong" error on API requests

This is a generic server error. Steps to diagnose:

1. **Check [status.sessionforge.dev](https://status.sessionforge.dev)** for any ongoing incidents.
2. **Retry the action** — transient network errors often resolve on retry.
3. If the error persists, open an issue at **support@sessionforge.dev** and include:
   - The exact action you were performing
   - The time of the error (UTC)
   - Any error codes shown in the UI

---

## Getting More Help

- **Documentation:** [docs.sessionforge.dev](https://docs.sessionforge.dev)
- **Community Discord:** [discord.sessionforge.dev](https://discord.sessionforge.dev)
- **Email Support:** support@sessionforge.dev (Pro and above plans get priority response)
- **GitHub Issues:** [github.com/sessionforge/sessionforge](https://github.com/sessionforge/sessionforge/issues)
