# Sprint QA Checklist — March 2026

**Sprint dates:** 2026-03-01 → 2026-03-14
**Deploying to:** sessionforge.dev (Cloud Run, us-central1)
**QA branch:** `.worktrees/agent-qa`
**Pre-deploy gate:** All steps must pass before triggering `deploy-production.yml`

---

## Features shipping this sprint

| Feature                                                          | Plan doc                                                 | QA owner skill                     |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| Post-purchase flow (modal + JWT refresh + webhook fix)           | `docs/plans/2026-02-28-post-purchase-flow.md`            | `qa-billing`                       |
| Team invites (token-based email invites, accept page, auto-join) | `docs/plans/2026-02-28-team-invites.md`                  | `qa-auth-validator` + invite smoke |
| Engineering skills gap closure (10 new skills, 4 enhanced)       | `docs/plans/2026-02-28-engineering-skills-gap-design.md` | internal — no deploy gate          |
| QA stack upgrade (Mailosaur, ToxiProxy, Percy, k6, Nuclei)       | `docs/plans/2026-02-28-qa-stack-upgrade.md`              | all QA skills                      |
| Infra: Cloud Run secrets + Upstash swap                          | PR #3 `dev/infra`                                        | `qa-smoke` + `qa-observability`    |

---

## Sprint QA Checklist

Run these in order. Do not skip steps. A failing step is a NO-GO until resolved.

---

### Step 1 — Unit and Integration Tests

**Skill:** none (run directly)
**Agent:** dispatch `superpowers:dispatching-parallel-agents` — one agent per test suite

```bash
cd .worktrees/agent-qa
npm run test:unit          # 0 failures required
npm run test:integration   # 0 failures required (skips OK)
```

**New this sprint — add coverage for:**

- [ ] `checkMachineLimit` and `checkSessionLimit` on upgraded plans (post-purchase)
- [ ] `inviteMember` tRPC procedure — happy path, duplicate email, expired token
- [ ] `acceptInvite` — valid token, already-member, wrong-org
- [ ] `POST /api/auth/refresh-session` — returns updated plan in JWT
- [ ] Stripe webhook `checkout.session.completed` — saves `stripeSubscriptionId`

**Skill to use while writing tests:** `superpowers:test-driven-development`

---

### Step 2 — Auth Validation

**Skill:** `qa-auth-validator`

- [ ] Magic link flow delivers email via Mailosaur and lands on onboarding
- [ ] Password reset email delivers, token works once, second use returns 400
- [ ] **New:** Registration with pending invite auto-joins org (Mailosaur confirms invite email delivered)
- [ ] **New:** Invite accept page (`/invites/[token]`) — valid token adds to org, expired token shows error, unknown token returns 404
- [ ] **New:** `POST /api/auth/refresh-session` — after plan upgrade, JWT reflects new plan without sign-out

---

### Step 3 — UX Flows

**Skill:** `qa-ux-flows`
**Agent:** dispatch `superpowers:dispatching-parallel-agents` — one agent per journey

All 5 existing journeys must still pass:

- [ ] Journey 1: Sign up → onboarding → add first machine
- [ ] Journey 2: Log in → dashboard → start session → stop session
- [ ] Journey 3: Upgrade plan → confirm billing portal accessible
- [ ] Journey 4: Invite team member → accept invite → member sees shared org
- [ ] Journey 5: Forgot password → reset → log in with new password

**New journeys added this sprint:**

- [ ] Journey 6: Complete Stripe checkout → `UpgradeSuccessModal` appears → plan reflected in UI immediately (no refresh required)
- [ ] Journey 7: Owner sends invite → invitee registers via invite link → auto-joined to org on first login

**Visual regression:** Percy snapshots required for:

- [ ] `UpgradeSuccessModal` (new component)
- [ ] `/invites/[token]` accept page (new route)
- [ ] `/settings/org` after plan upgrade (plan badge should update)

**Skill to use for new journey specs:** `qa-ux-flows` + `superpowers:test-driven-development`

---

### Step 4 — API Contracts

**Skill:** `api-contract-checker`

```bash
cd .worktrees/agent-qa
npm run test:integration -- tests/contract/api-contracts.test.ts
```

**Existing contracts (must still pass):**

- [ ] `GET /api/user` — returns `{ id, email, plan, orgId }`
- [ ] `GET /api/sessions` — paginated list with `status` field
- [ ] `GET /api/machines` — list with `status: online | offline`
- [ ] `POST /api/stripe/checkout` — returns `{ url: string }`
- [ ] `POST /api/stripe/portal` — returns `{ url: string }`

**New contracts added this sprint:**

- [ ] `POST /api/auth/refresh-session` — returns `{ ok: true }`, 401 without auth
- [ ] `GET /api/org/invites` — returns `{ data: Invite[] }`, 401 without auth, 403 on free plan
- [ ] `POST /api/org/members` — returns 201 on team+ plan, 403 on free plan, 409 on duplicate
- [ ] `DELETE /api/org/invites/[token]` — returns 200 on success, 401 without auth, 404 unknown token
- [ ] `POST /api/org/invites/[token]/accept` — returns 200, 404 unknown, 410 expired

**Schema:** Add all new response types to `packages/shared-types/src/index.ts` before merging.

---

### Step 5 — Security Sweep

**Skill:** `qa-security`

- [ ] Nuclei: 0 high or critical findings
- [ ] Rate limiting active on `/api/auth/login` — 6th attempt returns `429` with `Retry-After` header
- [ ] Rate limiting active on `/api/auth/register` — same test
- [ ] **New:** Invite token cannot be brute-forced — token must be cryptographically random (min 32 bytes hex), not sequential
- [ ] **New:** Invite accept endpoint (`POST /api/org/invites/[token]/accept`) — test that a valid token cannot be replayed after acceptance (returns 410)
- [ ] **New:** `/api/auth/refresh-session` — confirm endpoint requires auth (401 without session), cannot be used to elevate to arbitrary plan

---

### Step 6 — Performance Baseline

**Skill:** `qa-performance`

All p95 targets under 50 RPS:

- [ ] `POST /api/auth/login` < 200ms
- [ ] `GET /api/sessions` < 150ms
- [ ] WebSocket connect < 500ms
- [ ] **New:** `POST /api/auth/refresh-session` < 100ms (DB read + JWT update — must be fast, called on every upgrade landing)
- [ ] **New:** `GET /api/org/invites` < 150ms

---

### Step 7 — Observability Check

**Skill:** `qa-observability`

- [ ] Trigger a test auth event, confirm it appears in Coralogix within 60 seconds
- [ ] **New:** Trigger `checkout.session.completed` webhook (Stripe test mode), confirm trace appears in Coralogix with `stripeSubscriptionId` logged
- [ ] **New:** Send a team invite, confirm Resend delivery event logged
- [ ] No error rate spike from test traffic

---

### Step 8 — Smoke Tests and Synthetic Monitors

**Skill:** `qa-smoke`

Before deploy:

- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] All public routes return 200
- [ ] Protected routes redirect to `/login?callbackUrl=...`
- [ ] **New:** `/invites/[token]` with unknown token returns 404 (not 500)
- [ ] Checkly `sessionforge-homepage.spec.ts` — GREEN in both us-east-1 and eu-west-1
- [ ] Checkly `support-forge-homepage.spec.ts` — GREEN in both regions

After deploy:

- [ ] Re-run smoke, all green
- [ ] Wait 10 minutes, confirm Checkly still green across 2 full check cycles

---

### Step 9 — Invite Flow Verification

**Skill:** none (run directly)

```bash
cd apps/web
BASE_URL=http://localhost:3000 npx playwright test e2e/invites.spec.ts --project=chromium --reporter=list
```

Expected: 5 passed, 3 skipped (skipped require `E2E_TEST_SECRET` + team plan — verify pass in staging).

Invite endpoints smoke check:

- [ ] `GET /api/org/invites` — 401 unauth, 200 authed
- [ ] `POST /api/org/members` — 401 unauth, 403 free plan, 201 team+ plan
- [ ] `DELETE /api/org/invites/[token]` — 401 unauth, 404 unknown token
- [ ] `POST /api/org/invites/[token]/accept` — 404 unknown token

---

### Step 10 — Billing Flow Verification (new this sprint)

**Skill:** `qa-billing`

- [ ] Complete Stripe test checkout (use test card `4242 4242 4242 4242`)
- [ ] Confirm `UpgradeSuccessModal` appears on redirect to `/settings/org?upgraded=1`
- [ ] Confirm plan badge in UI updates immediately (no manual refresh)
- [ ] Confirm `stripeSubscriptionId` written to DB (check `organizations` table)
- [ ] Confirm welcome email delivered via Resend (check Resend dashboard or Mailosaur)
- [ ] Open billing portal — confirm subscription visible in Stripe portal
- [ ] Run Stripe test clock to simulate subscription renewal — confirm no errors logged

---

## Engineering Skills Used This Sprint

The following skills should be invoked during implementation, not just QA:

| Phase                    | Skill                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| Schema + migrations      | `database-migrations`, `drizzle-orm-patterns`                             |
| Route handlers           | `nextjs-app-router`, `back-end-dev-guidelines`                            |
| Frontend components      | `frontend-dev-guidelines`, `document-skills:frontend-design`              |
| tRPC procedures          | `trpc-patterns`                                                           |
| Redis / rate limiting    | `redis-cache-patterns`                                                    |
| Architecture decisions   | `sessionforge-architecture`, `senior-backend`                             |
| Writing feature specs    | `prd`                                                                     |
| Implementation planning  | `superpowers:writing-plans`                                               |
| Implementation execution | `superpowers:executing-plans`, `superpowers:subagent-driven-development`  |
| Parallel bug fixes       | `superpowers:dispatching-parallel-agents`                                 |
| Code review              | `superpowers:requesting-code-review`, `superpowers:receiving-code-review` |
| Pre-merge verification   | `superpowers:verification-before-completion`                              |

---

## Agent Dispatch Plan

Use `superpowers:dispatching-parallel-agents` to run these in parallel after implementation is complete:

| Agent   | Task                                                      |
| ------- | --------------------------------------------------------- |
| Agent 1 | Run Step 1 unit + integration tests, report failures      |
| Agent 2 | Run Step 3 UX flows (Playwright), capture Percy snapshots |
| Agent 3 | Run Step 4 API contract tests, flag any schema drift      |
| Agent 4 | Run Step 5 security sweep (Nuclei + rate limit checks)    |

Then sequentially:

- Step 2 (auth) — requires Mailosaur, run after agents return
- Step 6 (performance) — run k6 after auth confirmed
- Step 7 (observability) — run after perf, check Coralogix
- Steps 8–10 — final gate before deploy trigger

---

## Go / No-Go Decision

| Step                              | Failure mode                                        | Decision                          |
| --------------------------------- | --------------------------------------------------- | --------------------------------- |
| Step 1 — Unit/Integration         | Any failure                                         | NO-GO                             |
| Step 2 — Auth                     | Magic link, reset, or invite auto-join broken       | NO-GO                             |
| Step 3 — UX Flows                 | Any of the 7 journeys fail                          | NO-GO                             |
| Step 3 — Percy                    | Unreviewed visual regression                        | NO-GO — approve or fix first      |
| Step 4 — API Contracts            | Schema drift or missing field                       | NO-GO                             |
| Step 5 — Security (high/critical) | Nuclei finding                                      | NO-GO                             |
| Step 5 — Security (medium)        | Nuclei finding                                      | Deploy with tracking ticket       |
| Step 5 — Invite token             | Replayable or guessable                             | NO-GO                             |
| Step 6 — Performance              | p95 target exceeded                                 | Advisory — deploy with monitoring |
| Step 7 — Observability            | Traces missing                                      | Advisory — deploy with monitoring |
| Step 8 — Checkly pre-deploy       | Any monitor red                                     | NO-GO                             |
| Step 8 — Checkly post-deploy      | Any monitor red                                     | Roll back immediately             |
| Step 9 — Invite smoke             | Any of 5 tests fail                                 | NO-GO                             |
| Step 10 — Billing                 | Modal missing, plan stale, subscriptionId not saved | NO-GO                             |

---

## Rollback

```bash
gcloud run revisions list --service=sessionforge --region=us-central1

gcloud run services update-traffic sessionforge \
  --to-revisions=<previous-revision>=100 \
  --region=us-central1
```

---

## Post-Deploy Monitoring (15 minutes)

- [ ] Coralogix error rate — watch for spike above baseline
- [ ] Checkly — 2 full check cycles (~10 min)
- [ ] Sentry — no new issues introduced since deploy
- [ ] Stripe dashboard — webhook delivery success rate 100%
- [ ] Resend dashboard — invite email delivery rate nominal
