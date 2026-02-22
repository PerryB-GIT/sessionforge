#!/usr/bin/env bash
# Enable automated Cloud SQL backups for SessionForge production database.
# Run once after the Cloud SQL instance is created.
#
# Prerequisites:
#   gcloud auth login
#   gcloud config set project YOUR_PROJECT_ID

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-sessionforge-487719}"
INSTANCE="sessionforge-db"

echo "Enabling automated backups on Cloud SQL instance: $INSTANCE"

gcloud sql instances patch "$INSTANCE" \
  --project="$PROJECT_ID" \
  --backup-start-time="03:00" \
  --enable-bin-log \
  --retained-backups-count=7 \
  --retained-transaction-log-days=7

echo ""
echo "Backup configuration applied:"
echo "  - Daily automated backup at 03:00 UTC"
echo "  - 7-day backup retention"
echo "  - 7-day point-in-time recovery (transaction logs)"
echo ""
echo "Verify in console:"
echo "https://console.cloud.google.com/sql/instances/${INSTANCE}/backups?project=${PROJECT_ID}"
