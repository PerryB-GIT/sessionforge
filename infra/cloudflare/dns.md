# Cloudflare DNS Configuration

## Domain: sessionforge.dev

### DNS Records to Add

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | @ | (Cloud Run IP or CNAME to cloud run URL) | ✅ |
| A | www | (same) | ✅ |
| CNAME | api | (Cloud Run service URL) | ✅ |
| TXT | @ | v=spf1 include:_spf.resend.com ~all | ❌ |
| CNAME | resend._domainkey | (from Resend dashboard) | ❌ |

### SSL/TLS Settings
- Mode: Full (Strict)
- Always Use HTTPS: On
- Min TLS: 1.2
- HSTS: Enabled (max-age=31536000)

### Page Rules
- sessionforge.dev/* → Always use HTTPS

### Setup Steps
1. Add sessionforge.dev to Cloudflare
2. Update nameservers at registrar to Cloudflare's
3. Add DNS records above
4. Configure SSL settings
5. Verify domain in Resend dashboard for email
