# SessionForge API Reference

All API endpoints are served from `https://sessionforge.dev/api`.

**Authentication:** Include your API key in the `Authorization` header:
```
Authorization: Bearer sf_live_YOUR_API_KEY
```

API keys are created in **Settings > API Keys** and require a Pro or higher plan.

**Content type:** All request and response bodies use `application/json`.

**Response envelope:**
```json
{ "data": { /* ... */ } }          // success
{ "data": null, "error": { "code": "...", "message": "...", "statusCode": 0 } } // error
```

---

## Authentication

### POST /api/auth/register

Create a new user account.

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "StrongPass123!",
  "name": "Jane Smith"
}
```

**Responses:**
| Status | Meaning |
|--------|---------|
| `201` | Account created. Email verification sent. |
| `400` | Validation error (weak password, invalid email, missing fields). |
| `409` | Email already registered. |

---

### POST /api/auth/login

Log in and receive a session cookie.

**Request body:**
```json
{ "email": "user@example.com", "password": "StrongPass123!" }
```

**Responses:**
| Status | Meaning |
|--------|---------|
| `200` | Success. `Set-Cookie: next-auth.session-token=...` header is returned. |
| `400` | Missing email or password. |
| `401` | Invalid credentials. |

---

### POST /api/auth/logout

Invalidate the current session cookie.

**Responses:** `200` with cleared `Set-Cookie` header.

---

### POST /api/auth/forgot-password

Trigger a password reset email. Always returns `200` to avoid leaking email existence.

**Request body:**
```json
{ "email": "user@example.com" }
```

---

### GET /api/auth/me

Return the currently authenticated user.

**Responses:**
| Status | Meaning |
|--------|---------|
| `200` | `{ "data": { "id": "...", "email": "...", "name": "...", "plan": "free" } }` |
| `401` | Not authenticated. |

---

## Machines

### GET /api/machines

List all machines belonging to the authenticated user.

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "My Dev Box",
      "os": "linux",
      "hostname": "dev-01",
      "status": "online",
      "lastSeen": "2026-02-17T10:30:00Z",
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /api/machines

Register a new machine entry (the agent also does this automatically on first connect).

**Request body:**
```json
{
  "name": "My New Machine",
  "os": "linux",
  "hostname": "my-host",
  "version": "1.0.0"
}
```

**Responses:**
| Status | Meaning |
|--------|---------|
| `201` | Machine created. Returns full machine object. |
| `400` | Validation error. |
| `429` | Plan machine limit reached. |

---

### GET /api/machines/:id

Get a single machine by ID.

**Responses:** `200` with machine object, `401`, `404`.

---

### PATCH /api/machines/:id

Update a machine's name or other mutable fields.

**Request body:**
```json
{ "name": "Updated Name" }
```

**Responses:** `200` with updated machine, `401`, `404`.

---

### DELETE /api/machines/:id

Delete a machine. Any running sessions on the machine will be force-stopped.

**Responses:** `204` on success, `401`, `404`.

---

## Sessions

### GET /api/sessions

List all sessions for the authenticated user (across all machines).

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `machineId` | string | Filter by machine |
| `status` | `running\|stopped\|crashed\|paused` | Filter by status |
| `page` | number | Page number (default: 1) |
| `pageSize` | number | Results per page (default: 20, max: 100) |

**Response `200`:**
```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "machineId": "uuid",
        "processName": "claude",
        "workdir": "/home/user",
        "status": "running",
        "startedAt": "2026-02-17T10:00:00Z",
        "stoppedAt": null,
        "peakMemoryMb": 512.0,
        "avgCpuPercent": 15.3
      }
    ],
    "total": 42,
    "page": 1,
    "pageSize": 20,
    "hasMore": true
  }
}
```

---

### POST /api/sessions

Start a new session on a machine.

**Request body:**
```json
{
  "machineId": "uuid",
  "command": "claude",
  "workdir": "/home/user",
  "env": { "ANTHROPIC_API_KEY": "..." }
}
```

**Responses:**
| Status | Meaning |
|--------|---------|
| `201` | Session started. Returns session object with `status: "running"`. |
| `400` | Missing `machineId`. |
| `404` | Machine not found. |
| `409` | Machine is offline / session limit reached. |

---

### GET /api/sessions/:id

Get a single session by ID.

**Responses:** `200` with session object, `401`, `404`.

---

### POST /api/sessions/:id/stop

Stop a running session gracefully. Use `force: true` to SIGKILL.

**Request body (optional):**
```json
{ "force": false }
```

**Responses:**
| Status | Meaning |
|--------|---------|
| `200` | Session stopped. Returns updated session with `status: "stopped"`. |
| `409` | Session is not in `running` state. |
| `404` | Session not found. |

---

### DELETE /api/sessions/:id

Delete a session record from history.

**Responses:** `204` on success, `401`, `404`.

---

## API Keys

### GET /api/keys

List all API keys for the authenticated user.

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "CI Agent",
      "keyPrefix": "sf_live_a1b2c3d4",
      "scopes": ["agent"],
      "expiresAt": null,
      "lastUsed": "2026-02-17T09:00:00Z",
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

Note: The full key is only returned once, at creation time.

---

### POST /api/keys

Create a new API key.

**Request body:**
```json
{
  "name": "My CI Key",
  "scopes": ["agent", "read"],
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

**Response `201`:**
```json
{
  "data": {
    "key": "sf_live_abcdef1234567890abcdef1234567890abcdef123456789",
    "id": "uuid",
    "name": "My CI Key"
  }
}
```

**Important:** The full `key` value is only shown once. Store it securely.

---

### DELETE /api/keys/:id

Revoke an API key immediately.

**Responses:** `204` on success, `401`, `404`.

---

## WebSocket — Agent Protocol

The SessionForge Agent connects to:
```
wss://sessionforge.dev/api/ws/agent
```

**Authentication:** The API key is passed as an `Authorization` header during the WebSocket handshake:
```
Authorization: Bearer sf_live_YOUR_API_KEY
```

Unauthenticated connections receive an HTTP `401` response before the upgrade.

**Message format:** All messages are JSON-encoded text frames.

### Agent → Cloud messages

| Type | Required fields | Description |
|------|----------------|-------------|
| `register` | `machineId`, `name`, `os`, `hostname`, `version` | Sent on connect |
| `heartbeat` | `machineId`, `cpu`, `memory`, `disk`, `sessionCount` | Sent every 30 seconds |
| `session_started` | `session.{id, pid, processName, workdir, startedAt}` | Session has started |
| `session_stopped` | `sessionId`, `exitCode` | Session has stopped |
| `session_crashed` | `sessionId`, `error` | Session crashed unexpectedly |
| `session_output` | `sessionId`, `data` (base64 PTY bytes) | Terminal output chunk |

### Cloud → Agent messages

| Type | Required fields | Description |
|------|----------------|-------------|
| `start_session` | `requestId`, `command`, `workdir` | Start a new session |
| `stop_session` | `sessionId` | Stop a running session |
| `pause_session` | `sessionId` | Pause a running session |
| `resume_session` | `sessionId` | Resume a paused session |
| `session_input` | `sessionId`, `data` (base64 input bytes) | Keyboard input to terminal |
| `resize` | `sessionId`, `cols`, `rows` | Resize the PTY |
| `ping` | (none) | Keepalive — agent must not disconnect |

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHENTICATED` | 401 | No valid session or API key |
| `FORBIDDEN` | 403 | Authenticated but not authorized for this resource |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `EMAIL_TAKEN` | 409 | Email already registered |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `WEAK_PASSWORD` | 400 | Password does not meet strength requirements |
| `MACHINE_OFFLINE` | 409 | Cannot start session on offline machine |
| `SESSION_NOT_RUNNING` | 409 | Cannot stop a session that is not running |
| `PLAN_LIMIT_MACHINES` | 429 | Machine limit for current plan reached |
| `PLAN_LIMIT_SESSIONS` | 429 | Session limit for current plan reached |
| `FEATURE_NOT_AVAILABLE` | 403 | Feature not available on current plan |
| `EXPIRED` | 401 | API key or token has expired |
| `RATE_LIMITED` | 429 | Too many requests |

---

## Rate Limits

| Endpoint group | Limit |
|----------------|-------|
| Auth (register, login, forgot-password) | 10 req / minute per IP |
| Machine / Session APIs | 120 req / minute per user |
| WebSocket messages (heartbeat) | 1 per 15 seconds per machine |
| WebSocket messages (session_output) | Unlimited (streamed) |
