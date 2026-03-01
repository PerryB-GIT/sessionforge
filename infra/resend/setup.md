# Resend Email Setup

## Why Resend (not AWS SES)
- No sandbox approval process
- Simple API
- Free tier: 3,000 emails/month
- Excellent developer experience
- Works immediately after domain verification

## Setup Steps

1. Create account at resend.com
2. Add domain: sessionforge.dev
3. Add DNS records (Cloudflare):
   - CNAME resend._domainkey → (from Resend dashboard)
   - TXT @ → v=spf1 include:_spf.resend.com ~all
4. Wait for verification (usually < 5 min)
5. Get API key: re_xxxxx
6. Add to .env.local: RESEND_API_KEY=re_xxxxx

## Email Templates Needed (Phase 4)
- welcome.tsx
- verify-email.tsx
- magic-link.tsx
- password-reset.tsx
- plan-upgraded.tsx
- payment-failed.tsx
- machine-offline.tsx
- session-crashed.tsx
- team-invitation.tsx

## Usage Limits
- Free: 3,000/month, 100/day
- Pro ($20/mo): 50,000/month
- At our scale, free tier works until ~1,000 active users
