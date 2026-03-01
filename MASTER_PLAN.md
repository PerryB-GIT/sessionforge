# SessionForge — Master Build Plan

> Remote AI Session Management Platform
> Live at: https://sessionforge.dev
> Cloud Run: https://sessionforge-730654522335.us-central1.run.app
> Last updated: 2026-02-17 (DB + Redis complete)

---

## Current Status

| Layer | Status | Notes |
|-------|--------|-------|
| Next.js app (apps/web) | ✅ Built & deployed | GCP Cloud Run, us-central1 |
| Domain (sessionforge.dev) | ✅ Live | Cloudflare DNS → Google load balancer A records |
| SSL certificate | ⏳ Provisioning | ~10-15 min after DNS propagation |
| Google OAuth | ✅ Done | Redirect URI + JS origin set for sessionforge.dev |
| GitHub OAuth | ✅ Updated | Callback URL set to https://sessionforge.dev |
| Stripe | ✅ Done | Webhook + signing secret set, Pro/Team/Enterprise price IDs created (test mode) |
| Database (PostgreSQL) | ✅ Live | Cloud SQL `sessionforge-db` us-central1, all 10 tables created |
| Redis/Cache | ✅ Live | Upstash free tier, GCP us-central1, `ethical-crow-38335.upstash.io` |
| Go desktop agent | ✅ Built | Not yet published/distributed |
| Email (Resend) | ✅ Configured | DNS records set (MX, SPF, DKIM) |

---

## Phase 1 — Production Infrastructure (Priority: NOW)

### 1.1 Database — Cloud SQL (PostgreSQL)
**Blocker: App cannot persist any data without this.**

- [ ] Create Cloud SQL instance (PostgreSQL 15, us-central1)
  - Tier: `db-f1-micro` (free-ish, ~$10/mo) to start
  - Storage: 10GB SSD, auto-increase enabled
- [ ] Create database: `sessionforge`
- [ ] Create user: `sessionforge_user` with strong password
- [ ] Enable Cloud SQL Auth Proxy or use public IP with SSL
- [ ] Add `DATABASE_URL` to Cloud Run env vars
- [ ] Run Drizzle migrations: `npm run db:migrate --workspace=apps/web`
- [ ] Verify schema applied correctly

**Command to create:**
```bash
gcloud sql instances create sessionforge-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --project=sessionforge-487719
```

### 1.2 Redis — Upstash (Serverless Redis)
**Needed for: session storage, rate limiting, real-time pub/sub.**

- [ ] Create Upstash Redis database (free tier: 10k commands/day)
  - Region: us-east-1 (closest to Cloud Run us-central1)
  - Or use GCP Memorystore (~$35/mo) for lower latency
- [ ] Add `REDIS_URL` to Cloud Run env vars
- [ ] Test connection from Cloud Run

**Recommendation:** Start with Upstash free tier, upgrade to Memorystore when needed.

### 1.3 Google OAuth — Production Redirect URI
**Needed for: Google sign-in to work on sessionforge.dev.**

- [ ] Go to GCP Console → APIs & Services → OAuth 2.0 Clients
- [ ] Find the SessionForge OAuth client
- [ ] Add authorized redirect URI: `https://sessionforge.dev/api/auth/callback/google`
- [ ] Save and wait ~5 min for propagation
- [ ] Test Google sign-in on production

### 1.4 Stripe Webhook Registration
**Needed for: subscription events (payment success, cancellation, etc.).**

- [ ] Go to Stripe Dashboard → Developers → Webhooks
- [ ] Add endpoint: `https://sessionforge.dev/api/webhooks/stripe`
- [ ] Select events:
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] Copy webhook signing secret
- [ ] Add `STRIPE_WEBHOOK_SECRET` to Cloud Run env vars
- [ ] Test with Stripe CLI: `stripe listen --forward-to https://sessionforge.dev/api/webhooks/stripe`

### 1.5 Stripe Products & Price IDs
**Needed for: checkout flows to work.**

- [ ] Create products in Stripe Dashboard:
  - Free: no price needed
  - Pro: $19/mo → copy price ID → set `STRIPE_PRICE_PRO` in Cloud Run
  - Team: $49/mo → copy price ID → set `STRIPE_PRICE_TEAM` in Cloud Run
  - Enterprise: $199/mo → copy price ID → set `STRIPE_PRICE_ENTERPRISE` in Cloud Run
- [ ] Verify checkout flow works end-to-end

---

## Phase 2 — Auth & Onboarding Polish

### 2.1 Email Verification Flow
- [ ] Verify Resend sending from `noreply@sessionforge.dev` works in prod
- [ ] Test full signup → verify email → access dashboard flow
- [ ] Add email to waitlist/trial flow if applicable

### 2.2 Trial & Access Control
- [ ] Confirm trial dashboard UI is rendering correctly
- [ ] Test access control middleware (free vs pro vs team routes)
- [ ] Verify Stripe subscription status gates access properly

### 2.3 Admin Portal
- [ ] Test admin portal upgrade flow (admin can manually upgrade users)
- [ ] Confirm Calendly webhook integration works (demo booking → trial activation)

---

## Phase 3 — Go Desktop Agent Distribution

### 3.1 Agent Binary Builds
- [ ] Set up GitHub Actions to build agent binaries for:
  - Linux (amd64, arm64)
  - macOS (amd64, arm64)
  - Windows (amd64)
- [ ] Tag releases with semantic versioning

### 3.2 Install Script
- [ ] Create `https://sessionforge.dev/install.sh` (Linux/Mac)
- [ ] Create `https://sessionforge.dev/install.ps1` (Windows)
- [ ] Host scripts via Cloud Run or GCS bucket
- [ ] Test install flow end-to-end

### 3.3 Agent ↔ Platform Connection
- [ ] Verify WebSocket connection from agent to platform works in prod
- [ ] Test session registration, heartbeat, session listing
- [ ] Verify real-time dashboard updates

---

## Phase 4 — Growth & Monetization

### 4.1 Landing Page Optimization
- [ ] Add proper meta tags (OG image, description)
- [ ] Add Google Analytics or Plausible
- [ ] SEO: title, description, structured data

### 4.2 Waitlist / Early Access
- [ ] Decide: open signup now or waitlist first
- [ ] If waitlist: add waitlist form, collect emails via Resend
- [ ] Send welcome email sequence

### 4.3 Billing Portal
- [ ] Wire up Stripe Customer Portal for self-serve plan changes
- [ ] Add "Manage Subscription" link in dashboard settings

### 4.4 Usage Metering
- [ ] Track: active sessions, machines connected, API calls
- [ ] Display usage in dashboard
- [ ] Set up overage alerts

---

## Phase 5 — Reliability & Scaling

### 5.1 Monitoring & Alerting
- [ ] Set up GCP Cloud Monitoring for Cloud Run
- [ ] Alert on: error rate >1%, p99 latency >2s, instance count 0
- [ ] Integrate with uptime monitor (already configured in Perry's system)

### 5.2 Logging
- [ ] Structured logging from Next.js to Cloud Logging
- [ ] Log levels: info, warn, error
- [ ] Alerting on error spikes

### 5.3 Database Backups
- [ ] Enable automated Cloud SQL backups (daily, 7-day retention)
- [ ] Test restore procedure

### 5.4 CI/CD Pipeline
- [ ] GitHub Actions: on push to main → build → deploy to Cloud Run
- [ ] Add staging environment (separate Cloud Run service)
- [ ] Run tests before deploy

---

## Key Env Vars Checklist (Cloud Run)

| Variable | Status | Notes |
|----------|--------|-------|
| `NODE_ENV` | ✅ Set | production |
| `NEXTAUTH_URL` | ✅ Set | https://sessionforge.dev |
| `NEXTAUTH_SECRET` | ✅ Set | |
| `GOOGLE_CLIENT_ID` | ✅ Set | |
| `GOOGLE_CLIENT_SECRET` | ✅ Set | |
| `GITHUB_CLIENT_ID` | ✅ Set | |
| `GITHUB_CLIENT_SECRET` | ✅ Set | |
| `RESEND_API_KEY` | ✅ Set | |
| `STRIPE_SECRET_KEY` | ✅ Set | |
| `STRIPE_PUBLISHABLE_KEY` | ✅ Set | |
| `STRIPE_WEBHOOK_SECRET` | ✅ Set | `whsec_ZDWQH18B...` (test mode) |
| `STRIPE_PRICE_PRO` | ✅ Set | `price_1T1wrUBtLUlkVJhoMJz3IAUO` ($19/mo, test) |
| `STRIPE_PRICE_TEAM` | ✅ Set | `price_1T1wrVBtLUlkVJhomyGjPPwJ` ($49/mo, test) |
| `STRIPE_PRICE_ENTERPRISE` | ✅ Set | `price_1T1wrXBtLUlkVJhoxnuuNCIg` ($199/mo, test) |
| `DATABASE_URL` | ✅ Set | Cloud SQL `sessionforge-db`, unix socket via Cloud SQL Auth Proxy |
| `REDIS_URL` | ✅ Set | Upstash `ethical-crow-38335.upstash.io:6379` (TLS) |
| `GCS_BUCKET_NAME` | ✅ Set | |
| `GOOGLE_CLOUD_PROJECT` | ✅ Set | |

---

## Immediate Next Actions (Do These First)

1. ~~**Set up Cloud SQL** → get `DATABASE_URL` → run migrations~~ ✅ DONE
2. ~~**Set up Upstash Redis** → get `REDIS_URL`~~ ✅ DONE
3. ~~**Add Google OAuth redirect URI** for production domain~~ ✅ DONE
4. ~~**Register Stripe webhook** → get `STRIPE_WEBHOOK_SECRET`~~ ✅ DONE
5. ~~**Create Stripe products** → get price IDs~~ ✅ DONE (test mode)
6. **Redeploy Cloud Run** with all new env vars
7. **Test full signup → verify → pay → dashboard flow**

---

## Architecture Reference

```
sessionforge.dev
    │
    ▼
Cloudflare DNS (A records → Google load balancer)
    │
    ▼
GCP Cloud Run (us-central1) — sessionforge service
    │
    ├── NextAuth.js (Google + GitHub OAuth)
    ├── Drizzle ORM → Cloud SQL PostgreSQL
    ├── WebSocket server → Go desktop agents
    ├── Resend (transactional email)
    └── Stripe (subscriptions)
```

---

## Deploy Command

```bash
gcloud run deploy sessionforge \
  --source . \
  --region us-central1 \
  --project sessionforge-487719 \
  --allow-unauthenticated
```
