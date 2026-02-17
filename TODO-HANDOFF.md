# SessionForge — Agent Coordination Board
**Last Updated:** 2026-02-17 (Go Agent ✅ complete)
**Phase:** 3 (Frontend) + QA still running | Backend ✅ | Go Agent ✅ | DevOps ✅

---

## 🟢 ACTIVE AGENTS

| Agent | Worktree Branch | Status | Current Task |
|-------|----------------|--------|--------------|
| Backend Architect | dev/backend | ✅ DONE | All APIs, WebSocket, tRPC, Stripe — 27 files |
| Frontend Engineer | dev/frontend | 🔄 Building | Dashboard UI, auth pages, terminal, onboarding |
| Agent Developer | dev/desktop | ✅ DONE | Go CLI, PTY, WebSocket client — 28 files, 7 commits |
| DevOps Engineer | dev/infra | ✅ DONE | Docker, 5 CI/CD workflows, GCP infra, Cloudflare |
| QA Engineer | dev/qa | 🔄 Building | Vitest unit tests, Playwright E2E, integration tests |

---

## 📋 PENDING HANDOFFS

### [2026-02-17] Backend → Frontend (NEEDED BY FRONTEND)
- [ ] tRPC router is being built — Frontend should stub fetch calls to `/api/*` until tRPC is ready
- [ ] Auth endpoints: `POST /api/auth/register`, `POST /api/auth/login` — Frontend can wire these
- [ ] Machine API: `GET /api/machines`, `PATCH /api/machines/:id`, `DELETE /api/machines/:id`
- [ ] Session API: `GET /api/sessions`, `POST /api/sessions`, `DELETE /api/sessions/:id`
- [ ] WebSocket dashboard endpoint: `GET /api/ws/dashboard` — Frontend terminal depends on this
- [ ] API Key endpoints: `GET /api/keys`, `POST /api/keys`, `DELETE /api/keys/:id`

### [2026-02-17] Backend → Agent Developer (NEEDED BY AGENT)
- [ ] WebSocket agent endpoint: `wss://HOST/api/ws/agent?key=sf_live_xxx`
- [ ] Protocol: Agent sends `register` first, then `heartbeat` every 30s
- [ ] Auth: API key passed as query param `?key=`
- [ ] All message types defined in `packages/shared-types/src/ws-protocol.ts` — READ THAT FILE

### [2026-02-17] Backend → QA (NEEDED BY QA)
- [ ] Test DATABASE_URL format: `postgresql://sessionforge:localdev@localhost:5432/sessionforge_test`
- [ ] All API routes listed above — QA is writing integration tests against them
- [ ] Auth flows: register → verify email → login → JWT cookie

### [2026-02-17] DevOps → All Agents (NEEDED BY ALL)
- [ ] `docker-compose.yml` being created — run `docker-compose up -d` for local Postgres + Redis
- [ ] `.env.example` being created — copy to `.env.local` and fill in for local dev
- [ ] CI/CD pipelines being created in `.github/workflows/`

### [2026-02-17] Agent Developer → Frontend ✅ DONE — UNBLOCK FRONTEND INSTALL SECTION
- [x] Install command format: `curl -sSL https://sessionforge.dev/install.sh | sh -- --key sf_live_xxx`
- [x] Windows: `irm https://sessionforge.dev/install.ps1 | iex` with key param
- [x] Agent connects to `wss://HOST/api/ws/agent?key=API_KEY` on startup
- [x] Agent binary: `sessionforge-agent` (cross-compiled via goreleaser for linux/mac/windows amd64+arm64)
- [x] Config stored at: `~/.config/sessionforge/config.toml` (Linux/Mac), `%APPDATA%\sessionforge\config.toml` (Windows)
- [x] Service management: systemd (Linux), launchd (Mac), Windows Service
- [x] Self-update: `sessionforge-agent update` — pulls from GitHub Releases

### [2026-02-17] QA → All Agents (FOR ALL AGENTS)
- [ ] Test suite location: `tests/` in qa worktree
- [ ] To run unit tests: `vitest run`
- [ ] To run E2E: `playwright test`
- [ ] Coverage thresholds: 80% on auth, billing, sessions

---

## ✅ COMPLETED HANDOFFS

### [2026-02-17] Backend → Frontend ✅ DONE — UNBLOCK FRONTEND
- [x] tRPC router live: `machine.list`, `machine.get`, `machine.update`, `machine.delete`
- [x] tRPC session: `session.list`, `session.get`, `session.start`, `session.stop`, `session.logs`
- [x] tRPC org: `org.get`, `org.update`, `org.members`, `org.inviteMember`, `org.removeMember`
- [x] tRPC billing: `billing.getSubscription`, `billing.createCheckout`, `billing.createPortalSession`
- [x] REST auth: `POST /api/auth/register`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- [x] REST API keys: `GET /api/keys`, `POST /api/keys`, `DELETE /api/keys/:id`
- [x] REST machines: `GET /api/machines`, `GET /api/machines/:id`, `PATCH /api/machines/:id`, `DELETE /api/machines/:id`
- [x] REST sessions: `GET /api/sessions`, `POST /api/sessions`, `DELETE /api/sessions/:id`, `GET /api/sessions/:id/logs`
- [x] WebSocket agent: `GET /api/ws/agent?key=sf_live_xxx` — handles register, heartbeat, session_*, output
- [x] WebSocket dashboard: `GET /api/ws/dashboard` — auth via session cookie, forwards session_input/resize
- [x] Stripe webhook: `POST /api/webhooks/stripe` — checkout, subscription, payment_failed
- [x] Plan enforcement: `checkMachineLimit()`, `checkSessionLimit()`, `requireFeature()`
- [x] AppRouter type exported from `apps/web/src/server/router.ts` — import for tRPC client setup

### [2026-02-17] Backend → Agent Developer ✅ DONE — UNBLOCK AGENT
- [x] WebSocket endpoint confirmed: `wss://HOST/api/ws/agent?key=sf_live_xxx`
- [x] Auth: API key in `?key=` query param (sf_live_ format)
- [x] On connect: send `register` message immediately
- [x] Heartbeat: every 30s, server pings every 30s (respond to keep connection alive)
- [x] Server disconnects after 90s of no heartbeat — agent must reconnect
- [x] Session output: RPUSH to Redis ring buffer (2000 lines max)
- [x] All message types match `packages/shared-types/src/ws-protocol.ts` exactly

### [2026-02-17] Agent Developer → All ✅ DONE — Go Agent Complete
- [x] `agent/cmd/sessionforge/` — cobra CLI entrypoint (`start`, `stop`, `status`, `update`, `config`)
- [x] `agent/internal/config/` — TOML config management, auto-creates config dir on first run
- [x] `agent/internal/system/` — gopsutil for CPU/memory/disk/hostname/OS detection
- [x] `agent/internal/connection/` — WebSocket client with exponential backoff reconnection
- [x] `agent/internal/session/` — PTY process spawning (creack/pty on Unix, conpty on Windows)
- [x] `agent/internal/updater/` — self-update from GitHub Releases (go-update)
- [x] `agent/scripts/install.sh` — one-liner installer for Linux/Mac
- [x] `agent/scripts/install.ps1` — one-liner installer for Windows
- [x] `.goreleaser.yml` — cross-compiles for linux/darwin/windows × amd64/arm64 with checksums
- [x] Systemd unit: `agent/scripts/sessionforge-agent.service`
- [x] Launchd plist: `agent/scripts/com.sessionforge.agent.plist`
- [x] Windows Service: handled via agent `install-service` subcommand
- [x] All message types wire directly to `packages/shared-types/src/ws-protocol.ts`

### [2026-02-17] Backend → QA ✅ DONE — UNBLOCK QA
- [x] All API routes live and listed above — integration tests can target them
- [x] DB schema in `apps/web/src/db/schema/index.ts` — use for test fixtures
- [x] Test DB: `postgresql://sessionforge:localdev@localhost:5432/sessionforge` (from docker-compose)
- [x] Plan enforcement throws `PlanLimitError` and `FeatureNotAvailableError` — test these types

### [2026-02-17] DevOps → All Agents ✅ DONE
- [x] `docker-compose.yml` at repo root — run `docker-compose up -d` for local Postgres + Redis
- [x] `.env.example` at repo root — copy to `.env.local`, fill in values
- [x] `Dockerfile` multi-stage production build (non-root user, healthcheck)
- [x] `.github/workflows/ci.yml` — lint + typecheck + test + build on every push
- [x] `.github/workflows/deploy-staging.yml` — auto deploy on merge to main
- [x] `.github/workflows/deploy-production.yml` — manual trigger with confirmation
- [x] `.github/workflows/agent-release.yml` — goreleaser on `v*.*.*` tags
- [x] `.github/workflows/security-audit.yml` — weekly npm audit + govulncheck
- [x] `infra/gcp/setup.sh` — creates all GCP resources (Cloud SQL, Redis, GCS, secrets)
- [x] `infra/gcp/cloud-run-service.yml` — Cloud Run Knative service definition
- [x] `infra/cloudflare/dns-records.md` — DNS setup guide
- [x] `turbo.json` updated with all pipeline tasks
- [x] `package.json` updated with db:*, docker:* scripts

### [2026-02-17] Phase 0 → All Agents
- [x] Monorepo scaffold at `C:/Users/Jakeb/sessionforge/`
- [x] 5 git worktrees created in `.worktrees/`
- [x] Shared types in `packages/shared-types/src/`: api.ts, db-types.ts, ws-protocol.ts, plans.ts
- [x] DB schema stub in `apps/web/src/db/schema/index.ts`
- [x] Go agent scaffold in `agent/`
- [x] `.goreleaser.yml` in `agent/`
- [x] Install scripts scaffolded in `agent/scripts/`

---

## 🏗️ ARCHITECTURE DECISIONS (LOCKED — DO NOT CHANGE)

| Decision | Choice |
|----------|--------|
| Auth | NextAuth.js v5 — NO Clerk |
| Database | PostgreSQL via Drizzle ORM |
| Cache/PubSub | Redis (Memorystore in prod) |
| Email | Resend (free tier) |
| Payments | Stripe |
| Agent language | Go |
| API keys | `sf_live_` prefix, SHA-256 hashed |
| WebSocket auth | API key in query param for agent, cookie session for browser |
| Hosting | GCP Cloud Run |
| CDN/DNS | Cloudflare |

---

## 🔌 KEY INTEGRATION POINTS

### WebSocket Protocol (agent ↔ cloud)
```
wss://HOST/api/ws/agent?key=sf_live_xxx

1. Agent connects
2. Agent sends: { type: 'register', machineId, name, os, hostname, version }
3. Cloud responds with: machine confirmed
4. Agent sends heartbeat every 30s: { type: 'heartbeat', machineId, cpu, memory, disk, sessionCount }
5. Cloud sends: { type: 'start_session', requestId, command, workdir, env }
6. Agent responds: { type: 'session_started', session: { id, pid, processName, workdir, startedAt } }
7. Agent streams: { type: 'session_output', sessionId, data: base64 }
8. Cloud sends input: { type: 'session_input', sessionId, data: base64 }
```

### WebSocket Protocol (browser ↔ cloud)
```
wss://HOST/api/ws/dashboard (auth via session cookie)

Browser receives: machine_updated, session_updated, session_output, alert_fired
Browser sends: session_input (forwarded to agent via Redis pub/sub)
```

### API Key Format
```
Full key: sf_live_[32 random bytes hex] = 'sf_live_' + 64 char hex string
Prefix stored: first 8 chars after sf_live_ (shown in UI as sf_live_xxxxxxxx***)
Hash stored: SHA-256 of full key (used for lookup)
Never store full key after creation
```

---

## ⚠️ BLOCKERS / ISSUES

*None currently — update this section if you hit a blocker*

---

## 📝 NOTES FOR PERRY (Human Orchestrator)

- All 5 agents launched simultaneously 2026-02-17
- **3/5 agents DONE**: Backend ✅ | Go Agent ✅ | DevOps ✅
- **2/5 still running**: Frontend 🔄 | QA 🔄
- Phase 0 complete (scaffold done)
- Phase 1 Backend: ALL routes live — 27 files, 7 commits in dev/backend
- Phase 2 Go Agent: FULLY BUILT — 28 files, 7 commits in dev/desktop
- Phase 3 Frontend: Building now — dashboard, auth, terminal, onboarding
- QA: Building now — Vitest unit tests, Playwright E2E, integration tests
- **Integration next step**: Once Frontend + QA finish → merge all dev/* branches to dev/integration
- **Perry action needed**: Purchase domains — sessionforge.dev, sessionforge.com, sessionforge.io (~$34)
- **Perry action needed**: Set up Stripe products/prices and add price IDs to .env
- **Perry action needed**: Set up Resend account for transactional email (free tier, 3k emails/month)

---

*Update this file when you complete something another agent needs, or when you need something from another agent.*
*Format: `### [DATE] AgentName → AgentName (status)` then bullet the items.*
