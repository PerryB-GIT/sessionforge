# SessionForge — Master QA Plan
**Version:** 1.0
**Added to plan:** 2026-02-17
**Scope:** Pre-launch QA across all layers — functional, security, legal, privacy, and compliance

---

## 1. FUNCTIONAL QA

### 1.1 Auth Flows
- [ ] Email/password signup → email verification → login
- [ ] Password strength enforced (min 8 chars, complexity)
- [ ] Google OAuth: create account, subsequent logins link same user
- [ ] GitHub OAuth: create account, subsequent logins link same user
- [ ] Magic link (Resend): sends email, link works, expires after 15 min
- [ ] Forgot password: email sent, link works, expires after 1 hour, one-time use
- [ ] Reset password: new password saved, old sessions invalidated
- [ ] Logout: cookie cleared, session invalidated
- [ ] Protected routes redirect to /login when unauthenticated
- [ ] Session persists across browser refresh
- [ ] Concurrent logins from multiple devices work
- [ ] Account lockout after N failed login attempts (to implement)

### 1.2 Onboarding Wizard
- [ ] Step 1: Org name — saves correctly, slug auto-generated
- [ ] Step 2: API key — shows once, copy works, key stored hashed
- [ ] Step 3: Install command — correct for Linux/macOS/Windows tabs
- [ ] Step 4: Verify — polls until agent connects
- [ ] Step 5: Celebrate — redirects to dashboard
- [ ] Returning users skip onboarding if already completed

### 1.3 Machine Management
- [ ] Machine appears in list after agent registers
- [ ] Status indicator: online (green), offline (grey), error (red)
- [ ] CPU / Memory / Disk metrics update on each heartbeat (30s)
- [ ] Machine rename works and persists
- [ ] Machine delete: removes machine + orphans sessions
- [ ] Machine detail page: hostname, OS, version, uptime, metrics
- [ ] Offline detection: machine goes offline after 90s no heartbeat
- [ ] Machine limit enforced per plan (Free: 1, Pro: 5, Team: 20, Enterprise: ∞)

### 1.4 Session Management
- [ ] Start session: selects machine, spawns PTY, returns session ID
- [ ] xterm.js terminal: renders correctly, dark Catppuccin theme
- [ ] Terminal input: keystrokes forwarded to agent via WebSocket
- [ ] Terminal output: streams in real time, no buffering visible
- [ ] Terminal resize: ResizeObserver + fit addon sends SIGWINCH
- [ ] Session stop: PTY killed, status updated
- [ ] Session logs: scrollback available, logs persisted to Redis → GCS
- [ ] Concurrent session limit enforced per plan (Free: 3, Pro: ∞)
- [ ] Session history viewable after session ends
- [ ] Plan limit error shown in UI with upgrade prompt

### 1.5 API Keys
- [ ] Create key: full key shown exactly once, copy button works
- [ ] Key format: `sf_live_` + 64 hex chars
- [ ] Key list shows: name, prefix (`sf_live_xxxxxxxx***`), created date, last used
- [ ] Delete key: immediately invalidates — agent using it disconnects
- [ ] Key used for agent auth: `wss://HOST/api/ws/agent?key=sf_live_xxx`

### 1.6 Billing / Stripe
- [ ] Upgrade to Pro: Stripe Checkout opens, payment succeeds, plan updates
- [ ] Upgrade to Team / Enterprise: same flow
- [ ] Downgrade: handled via Customer Portal
- [ ] Webhook: checkout.session.completed → plan updated in DB
- [ ] Webhook: customer.subscription.deleted → downgrade to free
- [ ] Webhook: invoice.payment_failed → alert email sent via Resend
- [ ] 14-day Pro trial: activates without credit card
- [ ] Billing dashboard: shows current plan, usage, invoice history
- [ ] Plan enforcement: hard limits block action + show upgrade modal

### 1.7 Command Palette
- [ ] Cmd+K / Ctrl+K opens palette
- [ ] Navigation items: Dashboard, Machines, Sessions, Keys, Settings
- [ ] Machine and session items appear dynamically
- [ ] Arrow key navigation works
- [ ] Enter navigates, Escape closes
- [ ] Fuzzy search filters items

### 1.8 Real-Time Updates (WebSocket)
- [ ] `machine_updated` event updates machine status/metrics in UI without refresh
- [ ] `session_updated` event updates session status in list
- [ ] `alert_fired` shows toast notification
- [ ] WebSocket auto-reconnects after disconnect (max 5 attempts)
- [ ] Reconnect toast notification shown
- [ ] WS status indicator in UI reflects connection state

### 1.9 Org / Settings
- [ ] Org name and slug editable
- [ ] Invite member by email: email sent, invite link works, new member joins
- [ ] Role assignment: Owner, Admin, Member, Viewer
- [ ] Remove member: access revoked immediately
- [ ] Settings page: timezone, notifications, display preferences

### 1.10 Landing / Marketing Page
- [ ] Hero section loads, animated terminal demo plays
- [ ] Features section renders correctly
- [ ] Pricing cards show correct tiers and prices
- [ ] "Get Started" CTA links to /signup
- [ ] "Talk to Sales" CTA links to contact (or Calendly)
- [ ] Mobile responsive at 375px, 768px, 1440px
- [ ] Page speed: Lighthouse score > 90 (performance)
- [ ] OG tags correct for social sharing

---

## 2. AGENT QA (Go Binary)

- [ ] `sessionforge-agent --version` returns correct version
- [ ] `sessionforge-agent start` connects to WebSocket, sends register
- [ ] Reconnects with exponential backoff on disconnect
- [ ] Heartbeat sent every 30s with real CPU/memory/disk metrics
- [ ] PTY spawns correctly on Linux (bash/zsh)
- [ ] PTY spawns correctly on macOS (zsh)
- [ ] PTY spawns correctly on Windows (PowerShell/cmd via conpty)
- [ ] Session output streamed correctly in base64
- [ ] Session input received and forwarded to PTY
- [ ] Terminal resize (SIGWINCH) applied to PTY
- [ ] `sessionforge-agent stop` gracefully terminates
- [ ] `sessionforge-agent status` shows connection state
- [ ] `sessionforge-agent update` self-updates from GitHub Releases
- [ ] Config file created at correct path on first run
- [ ] Systemd unit: starts on boot, restarts on crash (Linux)
- [ ] Launchd plist: starts on login, restarts on crash (macOS)
- [ ] Windows Service: installs, starts, restarts on crash
- [ ] Install script (curl | sh): works on Ubuntu 22.04, Debian 12
- [ ] Install script (irm | iex): works on Windows 10/11
- [ ] Cross-compiled binaries pass checksum verification

---

## 3. SECURITY QA

### 3.1 Authentication & Authorization
- [ ] JWT tokens expire and refresh correctly
- [ ] JWT secret is rotated without breaking active sessions gracefully
- [ ] httpOnly cookies — not accessible via JS (`document.cookie`)
- [ ] CSRF protection active on all mutation endpoints
- [ ] OAuth state parameter validated (prevents CSRF on OAuth flow)
- [ ] API keys never stored in plain text — SHA-256 hash only
- [ ] API key lookup uses constant-time comparison (prevent timing attacks)
- [ ] Rate limiting on login endpoint (10 req/min per IP)
- [ ] Rate limiting on forgot-password (5 req/hour per email)
- [ ] Rate limiting on API key creation (20/day per user)

### 3.2 WebSocket Security
- [ ] Agent WS endpoint: rejects connections without valid API key
- [ ] Agent WS endpoint: invalid key returns 401, connection closed
- [ ] Dashboard WS endpoint: rejects unauthenticated requests
- [ ] Session input forwarded only to correct agent (no cross-org leakage)
- [ ] WebSocket messages validated against shared-types Zod schemas
- [ ] Redis pub/sub channels namespaced per org to prevent leakage

### 3.3 API Security
- [ ] All tRPC procedures require authenticated session
- [ ] User can only access own org's machines/sessions/keys
- [ ] Machine/session IDs are UUIDs (not enumerable integers)
- [ ] SQL injection: Drizzle ORM uses parameterized queries (verify)
- [ ] No raw SQL with user input
- [ ] File upload endpoints (if any) validate type and size

### 3.4 Infrastructure Security
- [ ] HTTPS enforced in production (Cloudflare + Cloud Run)
- [ ] HTTP → HTTPS redirect active
- [ ] HSTS header set (max-age=31536000, includeSubDomains)
- [ ] CSP header set (restrict script-src, no unsafe-inline)
- [ ] X-Frame-Options: DENY
- [ ] X-Content-Type-Options: nosniff
- [ ] Referrer-Policy: strict-origin-when-cross-origin
- [ ] Secrets in GCP Secret Manager — not in env files in prod
- [ ] Docker image runs as non-root user
- [ ] Dependencies audited: `npm audit` — no high/critical vulns
- [ ] Go dependencies audited: `govulncheck` — clean

### 3.5 Stripe Security
- [ ] Stripe webhook signature verified (`stripe.webhooks.constructEvent`)
- [ ] Webhook secret rotated after setting up
- [ ] No Stripe secret key logged or exposed to client
- [ ] Customer ID stored, not payment method details

### 3.6 Penetration Testing Checklist (pre-launch)
- [ ] OWASP Top 10 self-assessment
- [ ] XSS: all user-generated content HTML-escaped
- [ ] IDOR: test accessing another user's resources by guessing UUIDs
- [ ] Privilege escalation: free user accessing Pro features
- [ ] Session fixation: session token rotated on login
- [ ] Clickjacking: X-Frame-Options header blocks embedding

---

## 4. PERFORMANCE QA

- [ ] Landing page: Lighthouse Performance > 90, LCP < 2.5s
- [ ] Dashboard load: < 1s on fast connection
- [ ] Terminal latency: < 100ms input-to-output on LAN
- [ ] WebSocket: 100 concurrent connections without degradation
- [ ] WebSocket: 1000 concurrent connections (load test with k6)
- [ ] DB query time: all queries < 100ms (add indexes if needed)
- [ ] API endpoint P95: < 200ms
- [ ] Memory leak test: 8hr continuous agent connection — stable memory
- [ ] Redis pub/sub: messages delivered < 50ms

---

## 5. LEGAL & COMPLIANCE (PRE-LAUNCH REQUIRED)

### 5.1 Pages to Create (BLOCKING — cannot launch without these)
- [ ] **Terms of Service** (`/terms`) — see Section 5.2
- [ ] **Privacy Policy** (`/privacy`) — see Section 5.3
- [ ] **Acceptable Use Policy** (`/aup`) — see Section 5.4
- [ ] Cookie consent banner (GDPR/CCPA — EU/CA visitors)
- [ ] Footer links: Terms, Privacy, AUP, Contact

### 5.2 Terms of Service — Must Cover
- [ ] Acceptance of terms (clicking "Sign up" = acceptance)
- [ ] Description of service (remote session management SaaS)
- [ ] User responsibilities (no illegal use, no abuse)
- [ ] Agent installation — user consents to running software on their machines
- [ ] Data collected and how it's used
- [ ] Payment terms, refund policy (no refunds on annual, prorated on monthly)
- [ ] Plan limits and enforcement
- [ ] Service availability / uptime SLA (none for free, 99.9% for Enterprise)
- [ ] Suspension and termination rights
- [ ] Intellectual property — user owns their session content
- [ ] Limitation of liability (cap at 12 months of fees paid)
- [ ] Disclaimer of warranties
- [ ] Governing law (Massachusetts, USA — SupportForge location)
- [ ] Dispute resolution / arbitration clause
- [ ] Changes to terms (30-day notice by email)

### 5.3 Privacy Policy — Must Cover (GDPR + CCPA)
- [ ] What data is collected:
  - Account: email, name, password hash
  - Session: terminal I/O stored temporarily in Redis, flushed to GCS
  - Machine: hostname, OS, IP address, system metrics
  - Usage: login timestamps, API key usage, billing events
  - OAuth: provider ID, avatar URL
- [ ] Why data is collected (legitimate interest / contract performance)
- [ ] How data is stored (GCP Cloud SQL, Redis, GCS — US regions)
- [ ] Data retention: session logs 30 days (Pro), 90 days (Team), 1 year (Enterprise)
- [ ] Third parties: Stripe (payments), Resend (email), Google (OAuth + Cloud), GitHub (OAuth), Sentry (errors), Axiom (logs)
- [ ] User rights: access, correction, deletion, portability (GDPR)
- [ ] California rights: opt-out of sale (no sale occurs — state this)
- [ ] Cookie policy: session cookie (strictly necessary), no tracking cookies
- [ ] Contact for privacy: privacy@sessionforge.dev
- [ ] DPA available on request (for Enterprise/GDPR compliance)

### 5.4 Acceptable Use Policy — Must Cover
- [ ] Prohibited: illegal activities, CSAM, hacking third parties
- [ ] Prohibited: mining cryptocurrency via sessions
- [ ] Prohibited: running botnets or DDoS tools
- [ ] Prohibited: spamming via agent
- [ ] Prohibited: scraping in violation of other ToS
- [ ] Prohibited: circumventing plan limits
- [ ] Enforcement: warning → suspension → termination
- [ ] Reporting abuse: abuse@sessionforge.dev

### 5.5 Stripe / Billing Compliance
- [ ] PCI compliance: Stripe handles card data — we never touch it
- [ ] EU VAT: Stripe Tax handles VAT collection (enable in Stripe dashboard)
- [ ] Refund policy stated in ToS
- [ ] Subscription cancellation: immediate access until period end

### 5.6 Email Compliance (CAN-SPAM / GDPR)
- [ ] Transactional emails (verify, reset, invoice): always sent, no opt-out needed
- [ ] Marketing emails: opt-in only, unsubscribe link required
- [ ] From address: noreply@sessionforge.dev (Resend verified domain)
- [ ] Physical address in email footer (required by CAN-SPAM)

### 5.7 Open Source Compliance (Go Agent — MIT)
- [ ] LICENSE file in agent repo (MIT)
- [ ] All Go dependencies have compatible licenses (Apache, MIT, BSD)
- [ ] NOTICE file for any Apache 2.0 deps

---

## 6. ACCESSIBILITY QA

- [ ] All pages pass WCAG 2.1 AA
- [ ] Keyboard navigation: all interactive elements reachable
- [ ] Screen reader: aria-labels on icon buttons
- [ ] Color contrast: text/background ratio ≥ 4.5:1
- [ ] Focus indicators visible on all focusable elements
- [ ] Terminal: aria-live region for screen reader output (or skip to docs)
- [ ] Images have alt text
- [ ] Error messages associated with form fields via aria-describedby

---

## 7. CROSS-BROWSER / DEVICE QA

- [ ] Chrome 120+ (Windows, macOS)
- [ ] Firefox 120+ (Windows, macOS)
- [ ] Safari 17+ (macOS, iOS)
- [ ] Edge 120+ (Windows)
- [ ] Mobile: iPhone 14 (375px) — all pages
- [ ] Mobile: Android Galaxy S21 (360px) — all pages
- [ ] Tablet: iPad (768px) — dashboard, terminal
- [ ] Terminal (xterm.js): works in Chrome, Firefox, Safari

---

## 8. EMAIL QA (Resend)

- [ ] Welcome email: sent on signup, correct content, links work
- [ ] Verify email: token valid, expires 24h, one-time use
- [ ] Magic link: sent, expires 15min, works
- [ ] Forgot password: token valid, expires 1h, one-time use
- [ ] Password reset confirmation email sent
- [ ] Plan upgrade confirmation email
- [ ] Payment failed: warning email sent with retry instructions
- [ ] Cancellation: confirmation email sent
- [ ] All emails render correctly in Gmail, Outlook, Apple Mail
- [ ] Emails not landing in spam (check Resend delivery rate)
- [ ] Unsubscribe link works for non-transactional emails
- [ ] SPF, DKIM, DMARC configured for sessionforge.dev

---

## 9. CI/CD & DEPLOYMENT QA

- [ ] `npm run lint` passes clean
- [ ] `npm run type-check` passes clean (0 TS errors)
- [ ] `vitest run` — all 195 tests pass
- [ ] `playwright test` — E2E suite passes
- [ ] `govulncheck ./...` — no vulnerabilities in Go agent
- [ ] Docker build succeeds: `docker build -t sessionforge .`
- [ ] Docker image runs: health check returns 200
- [ ] GitHub Actions CI: all 5 workflows green on push to main
- [ ] Staging deploy: automatic on merge to main
- [ ] Production deploy: manual trigger with approval gate
- [ ] Rollback: previous revision reachable in Cloud Run
- [ ] goreleaser: `v*.*.*` tag triggers agent release with checksums

---

## 10. MONITORING & ALERTING QA

- [ ] Sentry: errors captured in production, alerts configured
- [ ] Axiom: logs streaming from Cloud Run
- [ ] UptimeRobot: monitoring / and /api/auth/session every 5min
- [ ] Alert: PagerDuty/email if uptime drops below 99.9%
- [ ] Alert: Stripe payment failure rate > 5%
- [ ] Alert: WebSocket error rate spikes
- [ ] Cloud Run: CPU > 80% alert
- [ ] Cloud SQL: connection pool exhaustion alert

---

## EXECUTION ORDER

```
GATE 1 — Cannot launch without:
  - Terms of Service page live
  - Privacy Policy page live
  - Acceptable Use Policy page live
  - Cookie consent banner
  - Email compliance (SPF/DKIM/DMARC)
  - Auth security (rate limiting, CSRF, httpOnly cookies)
  - Stripe webhook signature verification
  - HTTPS enforced

GATE 2 — Should complete before launch:
  - Full functional QA (Sections 1-2)
  - Security QA (Section 3)
  - Performance baseline (Section 4)
  - Email QA (Section 8)

GATE 3 — Post-launch within 30 days:
  - GDPR DPA template ready for Enterprise
  - Penetration test by third party
  - SOC 2 Type I readiness assessment
  - Accessibility audit
```

---

*Owned by Perry Bailes — SupportForge / SessionForge*
*Last Updated: 2026-02-17*
