# SessionForge Production Launch — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship sessionforge.dev to production — fix two config blockers, run DB migrations, deploy, verify end-to-end, then hand off to Perry for the launch sequence.

**Architecture:** Cursor Cloud Agents handle any code changes via PR (no direct pushes to master). Claude Code handles deploy, smoke tests, and verification. Perry handles all external service configs (Stripe dashboard, GCP console). No `--set-env-vars` is ever used — only `--update-secrets` to avoid wiping existing env vars (known production incident risk from support-forge.com).

**Tech Stack:** Next.js 14, Drizzle ORM, PostgreSQL (Cloud SQL db-f1-micro), Redis (Upstash), Stripe, GCP Cloud Run, Cursor API (claude-4.6-opus-high-thinking), Playwright (E2E)

**Cursor MCP tools used:** `cursor_launch_agent`, `cursor_get_agent`, `cursor_get_agent_conversation`

---

## Chunk 1: Preflight Checks (Claude runs these)

### Task 1: Baseline Audit Before Touching Anything

- [ ] **Step 1: Verify current Cloud Run env vars baseline**

```bash
gcloud run services describe sessionforge \
  --region=us-central1 --project=sessionforge-487719 \
  --format="yaml(spec.template.spec.containers[0].env)" 2>&1
```

Expected: All secrets listed. Capture this output — it is the rollback baseline.

- [ ] **Step 2: Confirm health check is live**

```bash
curl -sv https://sessionforge.dev/api/health 2>&1 | grep -E "subject|issuer|HTTP|status"
```

Expected: TLS cert issued to `sessionforge.dev` (not `*.run.app`). Response `{"status":"ok"}`.

- [ ] **Step 3: Confirm Cloud SQL instance tier**

```bash
gcloud sql instances describe sessionforge-db \
  --project=sessionforge-487719 \
  --format="value(settings.tier,settings.databaseFlags)" 2>&1
```

Note the tier. `db-f1-micro` = 100 connection limit. Acceptable for launch, watch under load.

- [ ] **Step 4: Check pending DB migrations**

```bash
cd C:/Users/Jakeb/sessionforge/apps/web && npx drizzle-kit status 2>&1 | tail -20
```

Expected: All migrations applied, or a list of pending ones. If pending → run Task 2. If all applied → skip Task 2.

- [ ] **Step 5: Confirm Stripe account is activated for live payments**

Perry: Go to https://dashboard.stripe.com → switch to **Live mode** → check for "Your account is activated" banner.
If not activated: complete Stripe's business activation flow (legal entity, bank account) before proceeding.

---

## Chunk 2: Database Migrations (if needed)

### Task 2: Apply Pending Migrations to Production Cloud SQL

> Only needed if Task 1 Step 4 showed pending migrations.

- [ ] **Step 1: Get production DATABASE_URL from Secret Manager**

```bash
gcloud secrets versions access latest \
  --secret=sessionforge-db-url \
  --project=sessionforge-487719 2>&1
```

- [ ] **Step 2: Run migrations against production DB**

```bash
cd C:/Users/Jakeb/sessionforge/apps/web && \
  DATABASE_URL="$(gcloud secrets versions access latest --secret=sessionforge-db-url --project=sessionforge-487719)" \
  npx drizzle-kit push 2>&1
```

Expected: "All changes applied" or "No changes to apply."

- [ ] **Step 3: Verify schema**

```bash
DATABASE_URL="<prod-url>" psql -c "\dt" 2>&1
```

Expected: 17 tables present (users, organizations, machines, sessions, apiKeys, etc.)

---

## Chunk 3: Code Fix via Cursor Agent

### Task 3: Fix GOOGLE_CLOUD_PROJECT Placeholder

**Files:**

- Modify: `infra/cloud-run-service.yml` — replace literal `PROJECT_ID` with `sessionforge-487719`
- Check: `infra/gcp/deploy.sh` — same replacement if present

- [ ] **Step 1: Launch Cursor agent**

Use `cursor_launch_agent` tool:

```json
{
  "prompt": "In infra/cloud-run-service.yml, find every occurrence of the literal string 'PROJECT_ID' (not a shell variable like $PROJECT_ID, but the bare literal placeholder) and replace with 'sessionforge-487719'. Also check infra/gcp/deploy.sh and any other file under infra/ for the same placeholder. Do not change anything else — no formatting, no other values. Create a PR against master.",
  "repository": "https://github.com/PerryB-GIT/sessionforge",
  "ref": "master",
  "model": "claude-4.6-opus-high-thinking",
  "auto_create_pr": true
}
```

- [ ] **Step 2: Poll until FINISHED**

Every 30s: `cursor_get_agent` with the returned agent ID.
Expected: `status: "FINISHED"` with a PR URL. If `ERROR`: check `cursor_get_agent_conversation` for the failure reason.

- [ ] **Step 3: Read the agent's diff**

Use `cursor_get_agent_conversation` — verify the agent only touched `PROJECT_ID` → `sessionforge-487719` and nothing else.

- [ ] **Step 4: Merge the PR**

```bash
cd C:/Users/Jakeb/sessionforge && \
  gh pr list --repo PerryB-GIT/sessionforge --state open --json number,title | head -5
# then:
gh pr merge <PR_NUMBER> --squash --repo PerryB-GIT/sessionforge
```

- [ ] **Step 5: Pull locally**

```bash
cd C:/Users/Jakeb/sessionforge && git pull origin master
```

---

## Chunk 4: Stripe Live Mode (Perry Action Required)

> **Perry completes these steps. Claude cannot access the Stripe dashboard.**
> Complete all steps before telling Claude to proceed to Chunk 5.

### Task 4: Switch Stripe to Live Mode

- [ ] **Step 1: Confirm Stripe account is activated**

Dashboard → Live mode → Look for activation banner. Do NOT proceed if not activated.

- [ ] **Step 2: Capture current test keys as rollback baseline**

From GCP Secret Manager, note existing `sessionforge-stripe-secret-key` value. If live keys break something, these test keys are the rollback.

- [ ] **Step 3: Get live keys**

Stripe Dashboard → Developers → API Keys → Live mode:

- Copy `pk_live_...` (Publishable key)
- Copy `sk_live_...` (Secret key)

- [ ] **Step 4: Create live products + price IDs**

Products → Create:

- **SessionForge Pro** → Recurring $19/mo → copy `price_live_...`
- **SessionForge Team** → Recurring $49/mo → copy `price_live_...`
- **SessionForge Enterprise** → Recurring $199/mo → copy `price_live_...`

- [ ] **Step 5: Register live webhook**

Developers → Webhooks → Add endpoint:

- URL: `https://sessionforge.dev/api/webhooks/stripe`
- Events to subscribe (select all):
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Copy `whsec_live_...` **immediately** before navigating away.
- Disable (not delete) the old test-mode webhook if one exists.

- [ ] **Step 6: Update GCP Secret Manager**

```bash
# Secret key
echo -n "sk_live_YOUR_KEY" | gcloud secrets versions add sessionforge-stripe-secret-key \
  --data-file=- --project=sessionforge-487719

# Publishable key (check if secret exists first)
gcloud secrets describe sessionforge-stripe-publishable-key --project=sessionforge-487719 2>/dev/null || \
  gcloud secrets create sessionforge-stripe-publishable-key --project=sessionforge-487719

echo -n "pk_live_YOUR_KEY" | gcloud secrets versions add sessionforge-stripe-publishable-key \
  --data-file=- --project=sessionforge-487719

# Webhook secret
echo -n "whsec_live_YOUR_SECRET" | gcloud secrets versions add sessionforge-stripe-webhook-secret \
  --data-file=- --project=sessionforge-487719

# Price IDs
echo -n "price_live_PRO_ID" | gcloud secrets versions add sessionforge-stripe-pro-price-id \
  --data-file=- --project=sessionforge-487719

echo -n "price_live_TEAM_ID" | gcloud secrets versions add sessionforge-stripe-team-price-id \
  --data-file=- --project=sessionforge-487719

echo -n "price_live_ENTERPRISE_ID" | gcloud secrets versions add sessionforge-stripe-enterprise-price-id \
  --data-file=- --project=sessionforge-487719
```

- [ ] **Step 7: Verify OAuth redirect URIs**

Google Cloud Console → APIs & Services → OAuth 2.0 Clients:

- Authorized redirect URI: `https://sessionforge.dev/api/auth/callback/google`

GitHub → Settings → Developer Settings → OAuth Apps → SessionForge:

- Authorization callback URL: `https://sessionforge.dev/api/auth/callback/github`

- [ ] **Step 8: Tell Claude "Stripe done, proceed to deploy"**

---

## Chunk 5: Deploy to Production

### Task 5: Build and Deploy

- [ ] **Step 1: Verify TypeScript compiles clean**

```bash
cd C:/Users/Jakeb/sessionforge/apps/web && npx tsc --noEmit 2>&1
```

Expected: zero errors. If errors: stop and fix before deploying.

- [ ] **Step 2: Verify build succeeds**

```bash
cd C:/Users/Jakeb/sessionforge/apps/web && npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Deploy to Cloud Run**

```bash
cd C:/Users/Jakeb/sessionforge && gcloud run deploy sessionforge \
  --source . \
  --region us-central1 \
  --project sessionforge-487719 \
  --allow-unauthenticated \
  --quiet 2>&1 | tail -20
```

Expected: `Service [sessionforge] revision [...] has been deployed and is serving 100 percent of traffic`

> **NEVER use `--set-env-vars` or `--update-env-vars`** — this replaces ALL env vars and wipes secrets. Use `--update-secrets` if a single secret needs updating post-deploy.

- [ ] **Step 4: Health check immediately post-deploy**

```bash
sleep 10 && curl -s https://sessionforge.dev/api/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 5: Check Cloud Run logs for startup errors**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="sessionforge" AND severity>=ERROR' \
  --limit=30 --project=sessionforge-487719 \
  --format="table(timestamp,textPayload)" 2>&1
```

Expected: No errors. If errors: see Rollback section at bottom.

---

## Chunk 6: Smoke Tests + Verification

### Task 6: End-to-End Verification

- [ ] **Step 1: Run Playwright E2E suite**

```bash
cd C:/Users/Jakeb/sessionforge/apps/web && \
  PLAYWRIGHT_BASE_URL=https://sessionforge.dev \
  npx playwright test e2e/ --reporter=list 2>&1 | tail -40
```

Expected: All tests pass or known-skipped. Zero failures on auth + dashboard flows.

- [ ] **Step 2: Manual Google OAuth check**

Open https://sessionforge.dev/login → "Continue with Google" → verify Google redirect and callback succeed → user lands on dashboard.

- [ ] **Step 3: Manual GitHub OAuth check**

Same flow with "Continue with GitHub".

- [ ] **Step 4: Stripe checkout verification (Stripe test card in live mode)**

Sign up for a new account → Billing → Upgrade to Pro.
Use Stripe test card: `4242 4242 4242 4242`, exp `12/26`, CVC `123`, any ZIP.
These test card numbers work in Stripe live mode without real charges.
Expected: Stripe dashboard shows a subscription created. User plan updates to `pro` in DB.

- [ ] **Step 5: Agent WebSocket check**

On Perry's local machine:

```bash
sessionforge start --key <api-key-from-dashboard>
```

Open https://sessionforge.dev/dashboard → Machines → machine should appear within 30s.

- [ ] **Step 6: Session terminal check**

Dashboard → click machine → Start Session → verify terminal opens and output streams.

- [ ] **Step 7: 15-minute clean log watch**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="sessionforge" AND severity>=ERROR' \
  --limit=50 --project=sessionforge-487719 \
  --freshness=15m \
  --format="table(timestamp,textPayload)" 2>&1
```

Expected: Zero 500 errors in 15 minutes post-deploy.

---

## Chunk 7: Monitoring Setup

### Task 7: Basic Error Alerting Before Launch

- [ ] **Step 1: Create Cloud Monitoring alert policy for 5xx errors**

```bash
gcloud alpha monitoring policies create \
  --policy-from-file=- <<'EOF'
{
  "displayName": "SessionForge 5xx Alert",
  "conditions": [{
    "displayName": "Cloud Run 5xx rate > 1%",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\"",
      "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_RATE"}],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0.01,
      "duration": "300s"
    }
  }],
  "alertStrategy": {"notificationRateLimit": {"period": "3600s"}},
  "combiner": "OR",
  "enabled": true
}
EOF
```

- [ ] **Step 2: Set up notification channel (email)**

```bash
gcloud alpha monitoring channels create \
  --display-name="Perry Email" \
  --type=email \
  --channel-labels=email_address=perry.bailes@gmail.com \
  --project=sessionforge-487719 2>&1
```

---

## Chunk 8: Launch Sign-Off

### Task 8: Pre-Launch Gate Checklist

All must be ✅ before Perry starts the LAUNCH-PLAN.md sequence.

- [ ] `curl https://sessionforge.dev/api/health` → `{"status":"ok"}`
- [ ] TLS cert issued to `sessionforge.dev` (not `*.run.app`)
- [ ] Stripe live mode confirmed (Stripe dashboard shows Live badge)
- [ ] Stripe account fully activated (not just test mode enabled)
- [ ] Google OAuth works on production
- [ ] GitHub OAuth works on production
- [ ] Stripe test card checkout completes, subscription appears in Stripe
- [ ] Agent connects: machine appears in dashboard within 30s
- [ ] Session terminal streams output
- [ ] Zero 500 errors in 15 min post-deploy
- [ ] Cloud Monitoring alert configured

**When all checked:** Perry follows `docs/LAUNCH-PLAN.md`.

---

## Rollback Procedure

If the deploy causes 500s or the app won't start:

```bash
# List recent revisions
gcloud run revisions list --service=sessionforge \
  --region=us-central1 --project=sessionforge-487719 \
  --format="table(name,status.conditions[0].status,createTime)" | head -10

# Roll back to previous revision (replace REVISION_NAME)
gcloud run services update-traffic sessionforge \
  --to-revisions=REVISION_NAME=100 \
  --region=us-central1 --project=sessionforge-487719
```

If Stripe live keys broke payments:

```bash
# Restore test keys
echo -n "sk_test_YOUR_OLD_KEY" | gcloud secrets versions add sessionforge-stripe-secret-key \
  --data-file=- --project=sessionforge-487719
# Then redeploy
```

---

## Cursor Agent Quick Reference

All agents for this project:

- **Repository:** `https://github.com/PerryB-GIT/sessionforge`
- **Branch:** `master`
- **Model:** `claude-4.6-opus-high-thinking`
- **Auto PR:** `true`

Check any running agent:

```
cursor_get_agent {agent_id}           → status
cursor_get_agent_conversation {id}    → what it did
cursor_list_agents                    → all agents
```
