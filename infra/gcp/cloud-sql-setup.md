# Cloud SQL PostgreSQL 16 Setup

## Overview

SessionForge uses Cloud SQL (PostgreSQL 16) for its primary database.
This document covers provisioning and configuration for both staging and production.

## Prerequisites

```bash
# Authenticate with GCP
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

## 1. Create Cloud SQL Instance

### Production

```bash
gcloud sql instances create sessionforge-db-prod \
  --database-version=POSTGRES_16 \
  --tier=db-g1-small \
  --region=us-central1 \
  --availability-type=ZONAL \
  --storage-type=SSD \
  --storage-size=20GB \
  --storage-auto-increase \
  --no-assign-ip \
  --network=default \
  --project=YOUR_PROJECT_ID
```

### Staging

```bash
gcloud sql instances create sessionforge-db-staging \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --availability-type=ZONAL \
  --storage-type=SSD \
  --storage-size=10GB \
  --no-assign-ip \
  --network=default \
  --project=YOUR_PROJECT_ID
```

## 2. Create Database and User

```bash
# Production database
gcloud sql databases create sessionforge \
  --instance=sessionforge-db-prod \
  --project=YOUR_PROJECT_ID

# Production user (password stored in Secret Manager)
gcloud sql users create sessionforge \
  --instance=sessionforge-db-prod \
  --password="$(openssl rand -base64 32)" \
  --project=YOUR_PROJECT_ID
```

## 3. Enable Private IP (Required for Cloud Run)

Cloud SQL private IP requires the Serverless VPC Access connector so
Cloud Run can reach it without a public IP.

```bash
# Create VPC connector
gcloud compute networks vpc-access connectors create sessionforge-connector \
  --region=us-central1 \
  --subnet=default \
  --subnet-project=YOUR_PROJECT_ID \
  --min-instances=2 \
  --max-instances=10 \
  --machine-type=e2-micro

# Add --vpc-connector flag to Cloud Run deploy commands
# --vpc-connector sessionforge-connector
# --vpc-egress all-traffic
```

## 4. Service Account for Cloud SQL Access

```bash
# The Cloud Run service account needs the Cloud SQL Client role
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:sessionforge-cloudrun-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

## 5. Store Connection String in Secret Manager

```bash
# Format: postgresql://USER:PASSWORD@/DBNAME?host=/cloudsql/PROJECT:REGION:INSTANCE
DB_PASSWORD=$(gcloud sql users describe sessionforge --instance=sessionforge-db-prod --format="value(password)")

gcloud secrets versions add sessionforge-db-url \
  --data-file=- << EOF
postgresql://sessionforge:${DB_PASSWORD}@/sessionforge?host=/cloudsql/YOUR_PROJECT_ID:us-central1:sessionforge-db-prod
EOF
```

## 6. Run Migrations

```bash
# From CI/CD pipeline or locally with Cloud SQL Proxy
cloud_sql_proxy -instances=YOUR_PROJECT_ID:us-central1:sessionforge-db-prod=tcp:5432 &
DATABASE_URL=postgresql://sessionforge:PASSWORD@localhost:5432/sessionforge \
  npm run db:push --workspace=apps/web
```

## Connection String Format

| Environment | Format |
|-------------|--------|
| Local dev   | `postgresql://sessionforge:localdev@localhost:5432/sessionforge` |
| Cloud Run   | `postgresql://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE` |
| Cloud SQL Proxy | `postgresql://user:pass@localhost:5432/dbname` |
