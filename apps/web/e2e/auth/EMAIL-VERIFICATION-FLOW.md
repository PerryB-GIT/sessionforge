# Email Verification Flow — Audit & E2E Documentation

**Sprint 2 — Agent 1 | Audited: 2026-02-20**

---

## Flow Overview

```
User submits register form
        │
        ▼
POST /api/auth/register
  → validate (zod)
  → check duplicate email (users table)
  → bcrypt hash password
  → insert user (emailVerified = NULL)
  → generate 32-byte hex token, expires in 24h
  → insert into verification_tokens (identifier=email, token, expires)
  → sendVerificationEmail() — non-blocking fire-and-forget
  → return 201 { data: { userId } }
        │
        ▼
Resend sends email to user
  Subject: "Verify your SessionForge email"
  CTA link: ${NEXTAUTH_URL}/api/auth/verify-email?token=<hex>
        │
        ▼
User clicks link → browser hits:
GET /api/auth/verify-email?token=<hex>
  → lookup verificationTokens WHERE token=? AND expires > NOW()
  → if not found → redirect /auth/verify?error=invalid_token
  → if found:
      UPDATE users SET emailVerified=NOW() WHERE email=identifier
      DELETE FROM verification_tokens WHERE identifier=? AND token=?
      redirect /auth/verify?success=true
        │
        ▼
/auth/verify page (client component)
  ?success=true  → "Email verified!" + Sign In link
  ?error=...     → "Verification failed" + error message
  (no params)    → "Check your email" (post-registration landing)
```

---

## Files Audited

| File | Status | Notes |
|------|--------|-------|
| `apps/web/src/app/api/auth/register/route.ts` | ✅ GOOD | Full validation, duplicate check, token gen, non-blocking email |
| `apps/web/src/lib/email.ts` | ✅ GOOD | Resend transport, correct verify URL path, branded HTML |
| `apps/web/src/app/api/auth/verify-email/route.ts` | ✅ GOOD | Expiry check, marks verified, deletes token |
| `apps/web/src/app/auth/verify/page.tsx` | ✅ GOOD | Suspense boundary, fallback skeleton |
| `apps/web/src/app/auth/verify/verify-content.tsx` | ✅ GOOD | All 3 states handled (success, error, default) |
| `apps/web/src/db/schema/index.ts` | ✅ GOOD | verificationTokens table exists, composite unique index |
| `apps/web/src/lib/auth.ts` | ✅ GOOD | Credentials provider blocks `!user.emailVerified` |

---

## Issues Found

### Minor — No standalone token uniqueness constraint (LOW risk)
**File:** `schema/index.ts` line 131–136
**Issue:** `verificationTokens` uses a composite unique index on `(identifier, token)`. The `token` column alone has no unique constraint. The verify-email route queries by `token` only, which is correct since `randomBytes(32)` produces 256-bit entropy (collision probability negligible). No change required, but worth noting.

### Gap — No register page UI in this worktree
**Issue:** `app/auth/register/` does not exist under the `dev/backend` worktree. The API endpoint works, but there is no frontend form to drive it. This is expected — the register UI is a frontend task (separate worktree/agent). The backend API is complete and correct.

---

## Security Notes

- Password hashing: `bcrypt` with cost factor 12 ✅
- Token entropy: `randomBytes(32)` = 256-bit ✅
- Token TTL: 24 hours, enforced at query time ✅
- Token deletion after use (single-use tokens) ✅
- Rate limiting on `/api/auth/register` via Upstash (5 req / 15 min / IP) ✅
- Email sending non-blocking — registration succeeds even if Resend is down ✅
- Login guard — unverified users cannot obtain a session via credentials ✅

---

## E2E Test Plan

Test file: `e2e/auth/email-verification.spec.ts`

### Registration API

| Test | Expected |
|------|----------|
| Valid payload | 201 + `{ data: { userId: string } }` |
| Duplicate email | 409 + `EMAIL_IN_USE` |
| Invalid email format | 400 + `VALIDATION_ERROR` |
| Password too short | 400 + `VALIDATION_ERROR` |

### /auth/verify Page

| URL | Expected UI |
|-----|-------------|
| `/auth/verify` | "Check your email" |
| `/auth/verify?success=true` | "Email verified!" + Sign In link |
| `/auth/verify?error=missing_token` | "Verification failed" + "No verification token" |
| `/auth/verify?error=invalid_token` | "Verification failed" + "invalid or has expired" |

### Verify-Email API

| Request | Expected |
|---------|----------|
| `GET /api/auth/verify-email` (no token) | redirect → `?error=missing_token` |
| `GET /api/auth/verify-email?token=BOGUS` | redirect → `?error=invalid_token` |
| `GET /api/auth/verify-email?token=VALID` | redirect → `?success=true`, user marked verified, token deleted |
| Replay same token | redirect → `?error=invalid_token` (token consumed) |

### Login Guard

| Scenario | Expected |
|----------|----------|
| Credentials login with unverified email | Blocked — 401 or redirect to error/login |
| Credentials login with verified email | Success — session created |

### Happy Path (requires email interceptor or DB seed helper)

1. `POST /api/auth/register` with valid payload
2. Retrieve raw token from `verification_tokens` table (test DB query)
3. `GET /api/auth/verify-email?token=<token>`
4. Assert redirect to `/auth/verify?success=true`
5. Assert `users.emailVerified` is set in DB
6. Assert token is deleted from `verification_tokens`
7. Attempt login → assert session created
8. Replay token → assert `invalid_token` error

---

## To Run Tests

```bash
# Install Playwright (first time)
npx playwright install chromium

# Run verification flow tests only
npx playwright test e2e/auth/email-verification.spec.ts

# Run with UI mode
npx playwright test e2e/auth/email-verification.spec.ts --ui

# Run headed (watch the browser)
npx playwright test e2e/auth/email-verification.spec.ts --headed
```

Set `NEXTAUTH_URL=http://localhost:3000` before running if not already in `.env.local`.

---

*Agent 1 — Email Verification Flow audit complete. No blocking bugs found.*
