#!/usr/bin/env bash
# =============================================================================
# SessionForge GCP Infrastructure Setup Script
# Provisions all GCP resources for production (and staging with --staging flag).
#
# Usage:
#   ./setup.sh --project YOUR_PROJECT_ID [--staging]
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Billing enabled on the project
#   - Owner or Editor role on the project
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
PROJECT_ID=""
IS_STAGING=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --project)
      PROJECT_ID="$2"
      shift 2
      ;;
    --staging)
      IS_STAGING=true
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: --project is required"
  echo "Usage: $0 --project YOUR_PROJECT_ID [--staging]"
  exit 1
fi

REGION="us-central1"
ENV_SUFFIX=$([ "$IS_STAGING" = true ] && echo "staging" || echo "prod")
SERVICE_ACCOUNT="sessionforge-cloudrun-sa@${PROJECT_ID}.iam.gserviceaccount.com"

echo "=============================================="
echo "SessionForge GCP Setup"
echo "  Project: $PROJECT_ID"
echo "  Region:  $REGION"
echo "  Env:     $ENV_SUFFIX"
echo "=============================================="
echo ""

# ---------------------------------------------------------------------------
# Step 1: Configure project and enable APIs
# ---------------------------------------------------------------------------
echo "[1/8] Setting default project and enabling APIs..."
gcloud config set project "$PROJECT_ID"

APIS=(
  run.googleapis.com
  sqladmin.googleapis.com
  redis.googleapis.com
  storage.googleapis.com
  secretmanager.googleapis.com
  cloudbuild.googleapis.com
  vpcaccess.googleapis.com
  iam.googleapis.com
)

for API in "${APIS[@]}"; do
  echo "  Enabling $API..."
  gcloud services enable "$API" --project="$PROJECT_ID" --quiet
done

# ---------------------------------------------------------------------------
# Step 2: Create Cloud Run service account
# ---------------------------------------------------------------------------
echo ""
echo "[2/8] Creating Cloud Run service account..."
gcloud iam service-accounts create sessionforge-cloudrun-sa \
  --display-name="SessionForge Cloud Run Service Account" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || echo "  Service account already exists, skipping."

# Grant required roles
for ROLE in roles/cloudsql.client roles/storage.objectAdmin roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="$ROLE" \
    --quiet
done

# ---------------------------------------------------------------------------
# Step 3: Create Cloud SQL PostgreSQL 16 instance
# ---------------------------------------------------------------------------
echo ""
echo "[3/8] Creating Cloud SQL instance (sessionforge-db-${ENV_SUFFIX})..."
SQL_TIER=$([ "$IS_STAGING" = true ] && echo "db-f1-micro" || echo "db-g1-small")
SQL_STORAGE=$([ "$IS_STAGING" = true ] && echo "10GB" || echo "20GB")

gcloud sql instances create "sessionforge-db-${ENV_SUFFIX}" \
  --database-version=POSTGRES_16 \
  --tier="$SQL_TIER" \
  --region="$REGION" \
  --availability-type=ZONAL \
  --storage-type=SSD \
  --storage-size="$SQL_STORAGE" \
  --storage-auto-increase \
  --no-assign-ip \
  --network=default \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || echo "  Cloud SQL instance already exists, skipping."

echo "  Creating database 'sessionforge'..."
gcloud sql databases create sessionforge \
  --instance="sessionforge-db-${ENV_SUFFIX}" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || echo "  Database already exists, skipping."

DB_PASSWORD=$(openssl rand -base64 32)
echo "  Creating database user 'sessionforge'..."
gcloud sql users create sessionforge \
  --instance="sessionforge-db-${ENV_SUFFIX}" \
  --password="$DB_PASSWORD" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || echo "  User already exists, skipping password reset."

# ---------------------------------------------------------------------------
# Step 4: Redis — using Upstash (external managed, not GCP Memorystore)
# ---------------------------------------------------------------------------
echo ""
echo "[4/8] Redis: using Upstash (no GCP resource to create)."
echo "  Populate secrets manually after setup:"
echo "    sessionforge-upstash-redis-url   — REST URL from Upstash console"
echo "    sessionforge-upstash-redis-token — REST token from Upstash console"

# ---------------------------------------------------------------------------
# Step 5: Create GCS bucket for session logs
# ---------------------------------------------------------------------------
echo ""
echo "[5/8] Creating GCS bucket (sessionforge-session-logs-${ENV_SUFFIX})..."
gsutil mb \
  -p "$PROJECT_ID" \
  -l "$REGION" \
  -c STANDARD \
  "gs://sessionforge-session-logs-${ENV_SUFFIX}" 2>/dev/null || echo "  Bucket already exists, skipping."

# Set lifecycle rule to auto-delete logs older than 90 days
cat > /tmp/lifecycle.json << 'EOF'
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 90}
      }
    ]
  }
}
EOF
gsutil lifecycle set /tmp/lifecycle.json "gs://sessionforge-session-logs-${ENV_SUFFIX}"

# ---------------------------------------------------------------------------
# Step 6: Create Secret Manager secrets
# ---------------------------------------------------------------------------
echo ""
echo "[6/8] Creating Secret Manager secrets..."

SECRETS=(
  "sessionforge-db-url"
  "sessionforge-nextauth-secret"
  "sessionforge-nextauth-url"
  "sessionforge-google-client-id"
  "sessionforge-google-client-secret"
  "sessionforge-github-client-id"
  "sessionforge-github-client-secret"
  "sessionforge-resend-api-key"
  "sessionforge-upstash-redis-url"
  "sessionforge-upstash-redis-token"
  "sessionforge-sentry-dsn"
  "sessionforge-stripe-secret-key"
  "sessionforge-stripe-webhook-secret"
  "sessionforge-stripe-pro-price-id"
  "sessionforge-stripe-team-price-id"
  "sessionforge-stripe-enterprise-price-id"
)

for SECRET in "${SECRETS[@]}"; do
  gcloud secrets create "$SECRET" \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null || echo "  Secret $SECRET already exists, skipping."
done

# Populate auto-generated secrets
echo "  Populating auto-generated secrets..."
NEXTAUTH_SECRET=$(openssl rand -base64 32)
printf '%s' "$NEXTAUTH_SECRET" | gcloud secrets versions add sessionforge-nextauth-secret \
  --data-file=- --project="$PROJECT_ID" --quiet

PROD_URL=$([ "$IS_STAGING" = true ] && echo "https://sessionforge-staging.sessionforge.dev" || echo "https://sessionforge.dev")
printf '%s' "$PROD_URL" | gcloud secrets versions add sessionforge-nextauth-url \
  --data-file=- --project="$PROJECT_ID" --quiet

# Populate DB URL (using Cloud SQL socket path format for Cloud Run)
DB_SOCKET_URL="postgresql://sessionforge:${DB_PASSWORD}@/sessionforge?host=/cloudsql/${PROJECT_ID}:${REGION}:sessionforge-db-${ENV_SUFFIX}"
printf '%s' "$DB_SOCKET_URL" | gcloud secrets versions add sessionforge-db-url \
  --data-file=- --project="$PROJECT_ID" --quiet

# ---------------------------------------------------------------------------
# Step 7: Create VPC Serverless Connector (for Cloud SQL private IP)
# ---------------------------------------------------------------------------
echo ""
echo "[7/8] Creating Serverless VPC Access connector..."
gcloud services enable vpcaccess.googleapis.com --project="$PROJECT_ID" --quiet
gcloud compute networks vpc-access connectors create sessionforge-connector \
  --region="$REGION" \
  --subnet=default \
  --subnet-project="$PROJECT_ID" \
  --min-instances=2 \
  --max-instances=10 \
  --machine-type=e2-micro \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || echo "  VPC connector already exists, skipping."

# ---------------------------------------------------------------------------
# Step 8: Deploy initial Cloud Run service
# ---------------------------------------------------------------------------
echo ""
echo "[8/8] Note: Cloud Run service will be deployed by GitHub Actions."
echo "  See: .github/workflows/deploy-${ENV_SUFFIX}.yml"
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "=============================================="
echo "Setup Complete!"
echo ""
echo "Resources created:"
echo "  Cloud SQL: sessionforge-db-${ENV_SUFFIX}"
echo "  Redis:     sessionforge-redis-${ENV_SUFFIX}"
echo "  GCS:       gs://sessionforge-session-logs-${ENV_SUFFIX}"
echo "  Secrets:   ${#SECRETS[@]} secrets in Secret Manager"
echo "  SA:        ${SERVICE_ACCOUNT}"
echo ""
echo "IMPORTANT - Fill these secrets manually in Secret Manager:"
echo "  - sessionforge-google-client-id"
echo "  - sessionforge-google-client-secret"
echo "  - sessionforge-github-client-id"
echo "  - sessionforge-github-client-secret"
echo "  - sessionforge-resend-api-key        (Resend dashboard — re_...)"
echo "  - sessionforge-upstash-redis-url     (Upstash console — REST URL)"
echo "  - sessionforge-upstash-redis-token   (Upstash console — REST token)"
echo "  - sessionforge-sentry-dsn            (Sentry project settings)"
echo "  - sessionforge-stripe-secret-key"
echo "  - sessionforge-stripe-webhook-secret"
echo "  - sessionforge-stripe-pro-price-id"
echo "  - sessionforge-stripe-team-price-id"
echo "  - sessionforge-stripe-enterprise-price-id"
echo ""
echo "Set GitHub Actions secrets:"
echo "  - GCP_PROJECT_ID = $PROJECT_ID"
echo "  - GCP_SA_KEY = (download service account key JSON)"
echo "  - GHCR_TOKEN = (GitHub Personal Access Token with packages:write)"
echo "=============================================="
