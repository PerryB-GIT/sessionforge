# Cloud Run Env Var Audit — Agent 4 QA/Infra
# Sprint: 2026-02-18
# Source of truth: infra/gcp/cloud-run-service.yml

---

## STATUS: ⚠️ ANTHROPIC_API_KEY MISSING — gcloud commands below ready for Overwatch approval

---

## 1. Env Vars Currently in cloud-run-service.yml

| Env Var | Source | Status |
|---------|--------|--------|
| `NODE_ENV` | inline (`production`) | ✅ Set |
| `PORT` | inline (`3000`) | ✅ Set |
| `DATABASE_URL` | Secret Manager: `sessionforge-db-url` | ✅ Set |
| `REDIS_URL` | Secret Manager: `sessionforge-redis-url` | ✅ Set |
| `NEXTAUTH_SECRET` | Secret Manager: `sessionforge-nextauth-secret` | ✅ Set |
| `NEXTAUTH_URL` | Secret Manager: `sessionforge-nextauth-url` | ✅ Set |
| `GOOGLE_CLIENT_ID` | Secret Manager: `sessionforge-google-client-id` | ✅ Set |
| `GOOGLE_CLIENT_SECRET` | Secret Manager: `sessionforge-google-client-secret` | ✅ Set |
| `GITHUB_CLIENT_ID` | Secret Manager: `sessionforge-github-client-id` | ✅ Set |
| `GITHUB_CLIENT_SECRET` | Secret Manager: `sessionforge-github-client-secret` | ✅ Set |
| `RESEND_API_KEY` | Secret Manager: `sessionforge-resend-api-key` | ⚠️ STALE — Resend removed from codebase |
| `STRIPE_SECRET_KEY` | Secret Manager: `sessionforge-stripe-secret-key` | ✅ Set |
| `STRIPE_WEBHOOK_SECRET` | Secret Manager: `sessionforge-stripe-webhook-secret` | ✅ Set |
| `STRIPE_PRO_PRICE_ID` | Secret Manager: `sessionforge-stripe-pro-price-id` | ✅ Set |
| `STRIPE_TEAM_PRICE_ID` | Secret Manager: `sessionforge-stripe-team-price-id` | ✅ Set |
| `STRIPE_ENTERPRISE_PRICE_ID` | Secret Manager: `sessionforge-stripe-enterprise-price-id` | ✅ Set |
| `GCS_BUCKET_NAME` | inline (`sessionforge-session-logs-prod`) | ✅ Set |
| `GOOGLE_CLOUD_PROJECT` | inline (`PROJECT_ID`) | ⚠️ Placeholder — must be real project ID |

---

## 2. Missing Env Vars (needed for current codebase)

| Env Var | Used In | Impact Without It |
|---------|---------|-------------------|
| `ANTHROPIC_API_KEY` | `apps/web/src/app/api/support/submit/route.ts:47` | Tickets still created, `aiDraft = null`. Perry reviews raw message — NOT a hard crash. |
| `PERRY_EMAIL` | `apps/web/src/lib/email.ts:5` | Support emails go to default `perry.bailes@gmail.com`. Low risk but should be explicit. |
| `SUPPORT_PERRY_REVIEW` | `apps/web/src/app/api/support/submit/route.ts:16-17` | Defaults to `false` in dev (no review emails). Production default behavior needs confirmation. |

---

## 3. Stale Env Vars (in cloud-run-service.yml, no longer needed)

| Env Var | Reason to Remove |
|---------|------------------|
| `RESEND_API_KEY` | Resend provider removed from `apps/web/src/lib/auth.ts` in revision 00054-fd6. No code path references this key anymore. Leaving it is harmless but adds confusion. |

---

## 4. Cloud Run livenessProbe / startupProbe

Both probes reference `/api/health`:
```yaml
livenessProbe:
  httpGet:
    path: /api/health    ← this route DOES NOT EXIST yet (returns 404)
startupProbe:
  httpGet:
    path: /api/health    ← same
```

**Impact**: Cloud Run will mark the revision as unhealthy and restart containers on a loop.
**Fix**: Agent 1 must create `apps/web/src/app/api/health/route.ts` returning HTTP 200.
This is BLOCKER-3 from the Overwatch log.

---

## 5. GOOGLE_CLOUD_PROJECT placeholder

`cloud-run-service.yml` has:
```yaml
- name: GOOGLE_CLOUD_PROJECT
  value: PROJECT_ID   ← PLACEHOLDER, not a real project ID
```
This must be replaced with the real GCP project ID (e.g. `sessionforge-prod` or similar).
Check via: `gcloud config get-value project`

---

## 6. gcloud Commands — AWAITING OVERWATCH APPROVAL

⚠️ DO NOT RUN until Overwatch logs approval in COORDINATION.md ⚠️

### 6a. Create Secret Manager secret for ANTHROPIC_API_KEY

```bash
# Step 1 — Create the secret (run once)
gcloud secrets create sessionforge-anthropic-api-key \
  --project=PROJECT_ID \
  --replication-policy=automatic

# Step 2 — Add the secret value
# Replace sk-ant-xxxx with the real key from https://console.anthropic.com
echo -n "sk-ant-xxxx" | gcloud secrets versions add sessionforge-anthropic-api-key \
  --project=PROJECT_ID \
  --data-file=-

# Step 3 — Grant Cloud Run service account access to the secret
gcloud secrets add-iam-policy-binding sessionforge-anthropic-api-key \
  --project=PROJECT_ID \
  --member="serviceAccount:sessionforge-cloudrun-sa@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 6b. Update Cloud Run service to add ANTHROPIC_API_KEY env var

Two options — pick one:

**Option A: gcloud update-env-vars (fastest, non-destructive)**
```bash
gcloud run services update sessionforge-production \
  --project=PROJECT_ID \
  --region=REGION \
  --update-secrets=ANTHROPIC_API_KEY=sessionforge-anthropic-api-key:latest
```

**Option B: redeploy with updated cloud-run-service.yml (recommended for audit trail)**
```bash
# After editing infra/gcp/cloud-run-service.yml to add ANTHROPIC_API_KEY section
gcloud run services replace infra/gcp/cloud-run-service.yml \
  --project=PROJECT_ID \
  --region=REGION
```

### 6c. Verify the secret is present on the live revision

```bash
gcloud run services describe sessionforge-production \
  --project=PROJECT_ID \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)"
```

### 6d. Optional — Remove stale RESEND_API_KEY

```bash
gcloud run services update sessionforge-production \
  --project=PROJECT_ID \
  --region=REGION \
  --remove-env-vars=RESEND_API_KEY
```

---

## 7. Recommended cloud-run-service.yml Change (for Agent 4 infra branch)

Add this block to `spec.template.spec.containers[0].env` in `cloud-run-service.yml`:

```yaml
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: sessionforge-anthropic-api-key
                  key: latest
            - name: PERRY_EMAIL
              valueFrom:
                secretKeyRef:
                  name: sessionforge-perry-email
                  key: latest
            - name: SUPPORT_PERRY_REVIEW
              value: "true"
```

And remove:
```yaml
            - name: RESEND_API_KEY
              valueFrom:
                secretKeyRef:
                  name: sessionforge-resend-api-key
                  key: latest
```

---

## 8. OAuth Redirect URI Configuration Required

These must be verified/configured MANUALLY in external dashboards.
The oauth-redirect-uri.spec.ts E2E tests validate the redirect flow.

### Google Cloud Console
URL: https://console.cloud.google.com/apis/credentials
Project: (SessionForge GCP project)
Credential type: OAuth 2.0 Client ID (Web application)

**Authorized JavaScript origins — must include:**
- `https://sessionforge.dev`

**Authorized redirect URIs — must include:**
- `https://sessionforge.dev/api/auth/callback/google`

### GitHub Developer Settings
URL: https://github.com/settings/developers → OAuth Apps → SessionForge
OR: Organization settings → Developer settings → OAuth Apps

**Homepage URL:**
- `https://sessionforge.dev`

**Authorization callback URL (exactly one):**
- `https://sessionforge.dev/api/auth/callback/github`

---

## 9. install.sh / install.ps1 Static File Serving — MISSING

**Blocker-5 from Agent 3 audit:**

The Go agent install scripts fetch from:
- `https://sessionforge.dev/install.sh`
- `https://sessionforge.dev/install.ps1`

These must be served as static files. Verified that `apps/web/` has NO `public/` directory.

**Fix required (Agent 4 scope — infra):**
Create `apps/web/public/` directory and add symlinks or copies of the scripts, OR
wire up Next.js middleware to proxy `/install.sh` → the GitHub releases download.

**Files to create (pending Overwatch assignment):**
- `apps/web/public/install.sh` → proxy to latest GitHub release for Linux/macOS
- `apps/web/public/install.ps1` → proxy to latest GitHub release for Windows

**Note:** Static files in `apps/web/public/` are served verbatim by Next.js at the root path.
This is the simplest fix once GitHub Releases exist.

---

## Summary of Actions Required

| # | Action | Owner | Needs Approval? |
|---|--------|-------|-----------------|
| 1 | Add `ANTHROPIC_API_KEY` to Secret Manager | Perry/DevOps | ✅ gcloud commands ready above — AWAITING approval |
| 2 | Add `ANTHROPIC_API_KEY` to Cloud Run service | Perry/DevOps | ✅ gcloud commands ready above — AWAITING approval |
| 3 | Update cloud-run-service.yml to add ANTHROPIC_API_KEY block | Agent 4 | No (infra file change, no gcloud run) |
| 4 | Remove RESEND_API_KEY from cloud-run-service.yml | Agent 4 | No (infra file change) |
| 5 | Fix GOOGLE_CLOUD_PROJECT placeholder in cloud-run-service.yml | Agent 4 | No (infra file change) |
| 6 | Register redirect URIs in Google Cloud Console | Perry | Manual — no gcloud command |
| 7 | Register callback URL in GitHub OAuth App | Perry | Manual — no gcloud command |
| 8 | Create apps/web/public/ and add install scripts | TBD | Awaiting Overwatch assignment |
| 9 | Agent 1: create /api/health route (critical — Cloud Run probes) | Agent 1 | No |
