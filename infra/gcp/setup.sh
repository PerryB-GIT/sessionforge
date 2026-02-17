#!/bin/bash
# SessionForge GCP Setup Script
# Run this once to provision all GCP resources
# Prerequisites: gcloud CLI installed and authenticated

set -e

PROJECT_ID_PROD="sessionforge-prod"
PROJECT_ID_STAGING="sessionforge-staging"
REGION="us-central1"

echo "🚀 Setting up SessionForge GCP Infrastructure"
echo ""

# Create projects
echo "Creating GCP projects..."
# gcloud projects create $PROJECT_ID_PROD --name="SessionForge Production"
# gcloud projects create $PROJECT_ID_STAGING --name="SessionForge Staging"

# Enable APIs
echo "Enabling required APIs..."
for API in run.googleapis.com sqladmin.googleapis.com redis.googleapis.com storage.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com; do
  echo "  Enabling $API..."
  # gcloud services enable $API --project=$PROJECT_ID_PROD
done

# Cloud SQL
echo "Cloud SQL setup:"
echo "  gcloud sql instances create sessionforge-db \\"
echo "    --database-version=POSTGRES_16 \\"
echo "    --tier=db-f1-micro \\"
echo "    --region=$REGION \\"
echo "    --project=$PROJECT_ID_PROD"

# Redis (Memorystore)
echo "Redis setup:"
echo "  gcloud redis instances create sessionforge-redis \\"
echo "    --size=1 \\"
echo "    --region=$REGION \\"
echo "    --tier=BASIC \\"
echo "    --project=$PROJECT_ID_PROD"

# GCS Buckets
echo "Storage bucket setup:"
echo "  gsutil mb -p $PROJECT_ID_PROD -l $REGION gs://sessionforge-session-logs-prod"
echo "  gsutil mb -p $PROJECT_ID_STAGING -l $REGION gs://sessionforge-session-logs-staging"

echo ""
echo "✅ GCP setup script ready. Uncomment commands and run with appropriate permissions."
echo "📖 See docs/infrastructure.md for full setup guide."
