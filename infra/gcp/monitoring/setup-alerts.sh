#!/usr/bin/env bash
# Setup GCP Cloud Monitoring alert policies for SessionForge.
# Run once: bash infra/gcp/monitoring/setup-alerts.sh
#
# Prerequisites:
#   gcloud auth login
#   gcloud config set project YOUR_PROJECT_ID
#   Set ALERT_EMAIL below (or pass as env var)
#
# What this creates:
#   1. Notification channel (email)
#   2. Alert: error rate > 1% over 5 min
#   3. Alert: p99 request latency > 2s over 5 min
#   4. Alert: active instance count = 0 (service down)
#   5. Alert: Cloud SQL DB reachability failure

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-sessionforge-487719}"
REGION="us-central1"
SERVICE_NAME="sessionforge"
ALERT_EMAIL="${ALERT_EMAIL:-perry@support-forge.com}"

echo "Setting up monitoring for project: $PROJECT_ID"
echo "Alerts will be sent to: $ALERT_EMAIL"
echo ""

# ── 1. Create email notification channel ────────────────────────────────────

echo "Creating email notification channel..."
CHANNEL_JSON=$(gcloud alpha monitoring channels create \
  --display-name="SessionForge Alerts" \
  --type=email \
  --channel-labels="email_address=${ALERT_EMAIL}" \
  --project="$PROJECT_ID" \
  --format=json)

CHANNEL_NAME=$(echo "$CHANNEL_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
echo "Notification channel: $CHANNEL_NAME"
echo ""

# ── Helper: create alert policy from JSON file ───────────────────────────────

create_policy() {
  local file="$1"
  local name="$2"
  # Substitute channel name into policy JSON
  sed "s|NOTIFICATION_CHANNEL|${CHANNEL_NAME}|g" "$file" | \
    gcloud alpha monitoring policies create \
      --policy-from-file=- \
      --project="$PROJECT_ID" \
      --format="value(name)"
  echo "Created alert: $name"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 2. Error rate > 1% ───────────────────────────────────────────────────────

cat > /tmp/sf-alert-error-rate.json <<EOF
{
  "displayName": "SessionForge: Error rate > 1%",
  "documentation": {
    "content": "Cloud Run error rate (5xx responses) exceeded 1% over a 5-minute window."
  },
  "conditions": [{
    "displayName": "5xx error rate > 1%",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE_NAME}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\"",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_RATE",
        "crossSeriesReducer": "REDUCE_SUM"
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0.01,
      "duration": "60s",
      "trigger": { "count": 1 }
    }
  }],
  "alertStrategy": { "autoClose": "1800s" },
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ["NOTIFICATION_CHANNEL"]
}
EOF
create_policy /tmp/sf-alert-error-rate.json "Error rate > 1%"

# ── 3. p99 latency > 2s ──────────────────────────────────────────────────────

cat > /tmp/sf-alert-latency.json <<EOF
{
  "displayName": "SessionForge: p99 latency > 2s",
  "documentation": {
    "content": "p99 request latency exceeded 2 seconds over a 5-minute window."
  },
  "conditions": [{
    "displayName": "p99 latency > 2s",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE_NAME}\" AND metric.type=\"run.googleapis.com/request_latencies\"",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_PERCENTILE_99",
        "crossSeriesReducer": "REDUCE_MAX"
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 2000,
      "duration": "60s",
      "trigger": { "count": 1 }
    }
  }],
  "alertStrategy": { "autoClose": "1800s" },
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ["NOTIFICATION_CHANNEL"]
}
EOF
create_policy /tmp/sf-alert-latency.json "p99 latency > 2s"

# ── 4. Instance count = 0 (service down) ────────────────────────────────────

cat > /tmp/sf-alert-instances.json <<EOF
{
  "displayName": "SessionForge: Instance count = 0 (service down)",
  "documentation": {
    "content": "No Cloud Run instances are active. The service may be down or failing to start."
  },
  "conditions": [{
    "displayName": "Active instance count = 0",
    "conditionThreshold": {
      "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE_NAME}\" AND metric.type=\"run.googleapis.com/container/instance_count\"",
      "aggregations": [{
        "alignmentPeriod": "120s",
        "perSeriesAligner": "ALIGN_MAX",
        "crossSeriesReducer": "REDUCE_MAX"
      }],
      "comparison": "COMPARISON_LT",
      "thresholdValue": 1,
      "duration": "120s",
      "trigger": { "count": 1 }
    }
  }],
  "alertStrategy": { "autoClose": "3600s" },
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ["NOTIFICATION_CHANNEL"]
}
EOF
create_policy /tmp/sf-alert-instances.json "Instance count = 0"

# ── 5. Cloud SQL health ───────────────────────────────────────────────────────

cat > /tmp/sf-alert-cloudsql.json <<EOF
{
  "displayName": "SessionForge: Cloud SQL server up = false",
  "documentation": {
    "content": "Cloud SQL instance sessionforge-db is not reachable. Database may be down."
  },
  "conditions": [{
    "displayName": "Cloud SQL server up = false",
    "conditionThreshold": {
      "filter": "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/up\"",
      "aggregations": [{
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_MIN",
        "crossSeriesReducer": "REDUCE_MIN"
      }],
      "comparison": "COMPARISON_LT",
      "thresholdValue": 1,
      "duration": "60s",
      "trigger": { "count": 1 }
    }
  }],
  "alertStrategy": { "autoClose": "3600s" },
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ["NOTIFICATION_CHANNEL"]
}
EOF
create_policy /tmp/sf-alert-cloudsql.json "Cloud SQL server up = false"

echo ""
echo "All alert policies created successfully."
echo "View in console: https://console.cloud.google.com/monitoring/alerting?project=${PROJECT_ID}"
