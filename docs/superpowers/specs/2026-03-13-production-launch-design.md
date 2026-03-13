# SessionForge — Production Launch Design Spec

**Date:** 2026-03-13
**Author:** Perry Bailes / Claude Code
**Status:** Draft → Review

---

## Goal

Ship sessionforge.dev to production. The codebase is complete — all 195 tests pass, Cloud Run is live, health check returns `{"status":"ok"}`. The remaining work is configuration, verification, one Cursor-powered code fix, and the launch sequence.

---

## Context

- **Live URL:** https://sessionforge.dev (Cloud Run `sessionforge-487719`, us-central1)
- **Repo:** github.com/PerryB-GIT/sessionforge (master branch)
- **Stack:** Next.js 14, Drizzle ORM, PostgreSQL (Cloud SQL), Redis (Upstash), Stripe, GCP
- **Cursor API:** Full Pro access — `cursor_launch_agent` can push code changes directly to the repo

---

## What's Blocking Launch

### 1. Stripe Test Mode (BLOCKER)

Currently using `sk_test_*` keys in Cloud Run. Payments will fail silently in "production."

- Switch to live Stripe keys
- Register live webhook at `https://sessionforge.dev/api/webhooks/stripe`
- Update 3 price IDs to live values

### 2. `GOOGLE_CLOUD_PROJECT` Placeholder (BLOCKER)

`infra/cloud-run-service.yml` has `PROJECT_ID` as a literal placeholder. Cloud Run env var must be `sessionforge-487719`.

### 3. Install Script URL Mismatch (MINOR — already fixed)

`apps/web/public/install.sh` and `install.ps1` exist. Agent documentation points to the right URL. ✅

### 4. `ANTHROPIC_API_KEY` Missing (NON-BLOCKING)

Support ticket AI drafting returns `null` without it. Tickets still submit. Set it for completeness.

---

## Approach: Cursor-Augmented Launch

Instead of manually pushing every fix, we use the Cursor MCP to dispatch agents against the sessionforge repo for any code changes. Perry handles the external service configs (Stripe dashboard, GCP console).

### Division of Work

| Task                                                | Who            | How                                      |
| --------------------------------------------------- | -------------- | ---------------------------------------- |
| Stripe live keys + webhook registration             | Perry (manual) | Stripe dashboard → gcloud secrets update |
| Fix `GOOGLE_CLOUD_PROJECT` in cloud-run-service.yml | Cursor Agent   | `cursor_launch_agent` → auto PR          |
| Final QA smoke test (E2E)                           | Claude Code    | Playwright via MCP                       |
| Deploy to Cloud Run                                 | Claude Code    | `cloud-run-deploy` skill + gcloud        |
| Launch sequence (PH, HN, social)                    | Perry (manual) | Existing content in LAUNCH-PLAN.md       |

---

## Implementation Plan

### Phase 1 — Config Fixes (30 min)

1. Perry: Get Stripe live keys from dashboard
2. Perry: Run `gcloud secrets versions add` for `sessionforge-stripe-secret-key`, `sessionforge-stripe-publishable-key`, `sessionforge-stripe-webhook-secret`, and 3 price ID secrets
3. Claude: Fix `GOOGLE_CLOUD_PROJECT` placeholder → launch Cursor agent against repo → merge PR
4. Claude: Verify all env vars match `infra/cloud-run-env-audit.md`

### Phase 2 — Deploy (15 min)

1. Claude: Run full deploy via Cloud Run skill
2. Claude: Hit health check endpoint post-deploy
3. Claude: Run smoke test suite against live URL

### Phase 3 — Verification (15 min)

1. Confirm Google + GitHub OAuth flows work
2. Confirm Stripe checkout flow (use Stripe test card first, then remove)
3. Confirm agent WebSocket connection registers a machine in dashboard
4. Confirm session start/stop works end-to-end

### Phase 4 — Launch (Perry-led)

Follow `docs/LAUNCH-PLAN.md` launch day sequence:

- Product Hunt 12:01am PT
- Show HN 9:00am
- Social 9:30am

---

## Cursor Agent Usage

Cursor agents will be used for:

- **Code fixes:** Any config/code change that needs a commit + PR (e.g., GOOGLE_CLOUD_PROJECT fix)
- **Future feature work:** Post-launch issues, bug reports, new features

Agents are launched via `cursor_launch_agent` with:

- Repository: `https://github.com/PerryB-GIT/sessionforge`
- Model: `claude-4.6-opus-high-thinking` (highest quality for production code)
- `autoCreatePr: true` — every change lands as a reviewable PR

---

## Success Criteria

- [ ] `curl https://sessionforge.dev/api/health` returns `{"status":"ok"}`
- [ ] Stripe live mode: a test checkout completes and creates a subscription in Stripe dashboard
- [ ] Go agent connects: machine appears in dashboard within 30s of `sessionforge start`
- [ ] Session starts: terminal output streams to dashboard
- [ ] No 500 errors in Cloud Run logs for 15 min after deploy

---

## Out of Scope (Post-Launch)

- SEO meta tags / Google Analytics
- Product Hunt / HN posts (Perry handles)
- Mobile app
- SAML/OIDC SSO implementation
- Usage metering dashboard
