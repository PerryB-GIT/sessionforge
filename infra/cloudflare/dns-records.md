# Cloudflare DNS Configuration for sessionforge.dev

## Overview

SessionForge uses Cloudflare for DNS, CDN, and DDoS protection.
The backend is hosted on GCP Cloud Run in us-central1.

## Prerequisites

1. Add `sessionforge.dev` to Cloudflare (Free tier is sufficient)
2. Update nameservers at your registrar to Cloudflare's provided nameservers
3. Wait for DNS propagation (up to 48 hours, usually minutes)

## DNS Records

Add the following records in the Cloudflare DNS dashboard:

### Production (sessionforge.dev)

| Type  | Name                   | Value                                                        | Proxy | TTL  | Notes                              |
|-------|------------------------|--------------------------------------------------------------|-------|------|------------------------------------|
| CNAME | `@`                    | `sessionforge-production-HASH-uc.a.run.app`                 | ON    | Auto | Root domain → Cloud Run            |
| CNAME | `www`                  | `sessionforge.dev`                                          | ON    | Auto | www redirect to apex               |
| CNAME | `api`                  | `sessionforge-production-HASH-uc.a.run.app`                 | ON    | Auto | API subdomain (same Cloud Run)      |
| CNAME | `staging`              | `sessionforge-staging-HASH-uc.a.run.app`                    | ON    | Auto | Staging environment                |
| TXT   | `@`                    | `v=spf1 include:_spf.resend.com ~all`                       | OFF   | Auto | Email SPF record for Resend         |
| CNAME | `resend._domainkey`    | (from Resend dashboard → Domain settings)                   | OFF   | Auto | DKIM for transactional email        |
| TXT   | `_dmarc`               | `v=DMARC1; p=quarantine; rua=mailto:dmarc@sessionforge.dev` | OFF   | Auto | DMARC policy                        |

> **Note:** Replace `HASH` in Cloud Run URLs with the actual hash from your deployment.
> Find it with: `gcloud run services describe sessionforge-production --region us-central1 --format "value(status.url)"`

### Root Domain CNAME Caveat

Cloudflare's CNAME Flattening feature automatically handles root domain CNAME records
(RFC-disallowed for non-Cloudflare DNS). No extra config needed.

## SSL/TLS Settings

Navigate to: **SSL/TLS > Overview**

| Setting              | Value              |
|----------------------|--------------------|
| Encryption mode      | **Full (strict)**  |
| Always Use HTTPS     | On                 |
| Minimum TLS Version  | TLS 1.2            |
| TLS 1.3              | Enabled            |
| HSTS                 | Enabled            |
| HSTS max-age         | 31536000 (1 year)  |
| HSTS include subdomains | Yes             |
| HSTS preload         | Yes (after stability confirmed) |

## Page Rules

Navigate to: **Rules > Page Rules** (or use Redirect Rules - newer)

### Rule 1: Force HTTPS on www

| Field    | Value                          |
|----------|-------------------------------|
| If URL   | `www.sessionforge.dev/*`       |
| Then     | Forwarding URL (301)           |
| To       | `https://sessionforge.dev/$1`  |

### Rule 2 (Optional): Cache API separately

| Field    | Value                          |
|----------|-------------------------------|
| If URL   | `sessionforge.dev/api/*`       |
| Then     | Cache Level = Bypass           |

## Firewall / Security Settings

Navigate to: **Security > Settings**

| Setting              | Value    |
|----------------------|----------|
| Security Level       | Medium   |
| Browser Integrity Check | On   |
| Bot Fight Mode       | On       |

## Resend Domain Verification Steps

1. Go to [Resend Dashboard](https://resend.com/domains)
2. Click "Add Domain" → enter `sessionforge.dev`
3. Copy the DKIM CNAME record (resend._domainkey → ...)
4. Add it to Cloudflare DNS with **Proxy: OFF** (DNS only)
5. Click "Verify" in Resend dashboard

## Setup Checklist

- [ ] Add domain to Cloudflare account
- [ ] Update nameservers at registrar (check propagation: `nslookup -type=NS sessionforge.dev`)
- [ ] Add all DNS records from the table above
- [ ] Set SSL mode to Full (strict)
- [ ] Enable Always Use HTTPS
- [ ] Configure HSTS
- [ ] Add www redirect page rule
- [ ] Verify Resend domain for transactional email
- [ ] Test root domain loads Cloud Run app
- [ ] Test www redirects to root
- [ ] Test SSL certificate is valid (`curl -I https://sessionforge.dev`)
