# Post-Purchase Flow Design

**Date:** 2026-02-28
**Status:** Approved
**Approach:** Option B — Modal + webhook fix + session refresh

---

## Problem

When a user completes Stripe checkout and lands back on `/settings/org?upgraded=1`:

1. The JWT still carries the old plan — the UI shows "Free" until the user manually refreshes or re-logs in.
2. `stripeSubscriptionId` is never written to the DB (only `stripeCustomerId` is saved), breaking future subscription management via the billing portal.
3. No welcome email is sent after a successful upgrade.
4. The existing toast ("Plan upgraded successfully!") is the only feedback — no clear next action.

---

## Design

### 1. Webhook fix — save `stripeSubscriptionId`

**File:** `apps/web/src/app/api/webhooks/stripe/route.ts`

In the `checkout.session.completed` handler, `session.subscription` contains the Stripe subscription ID as a string. Write it to the DB alongside `stripeCustomerId`:

- If `orgId` is present → update `organizations.stripeSubscriptionId`
- Otherwise → update `users` (users table already has `stripeCustomerId`; add `stripeSubscriptionId` column if not present, or store on org only)

Failure here must not affect the webhook `200` response — wrap in try/catch, log and continue.

---

### 2. Session refresh endpoint

**New file:** `apps/web/src/app/api/auth/refresh-session/route.ts`

```
POST /api/auth/refresh-session
Auth: required (401 if not authenticated)
Body: none
Response: { ok: true }
```

Handler:
1. Reads `users.plan` fresh from DB for the authenticated user
2. Calls NextAuth `update({ plan })` to push the new plan into the JWT
3. Returns `{ ok: true }`

This is the clean fix for the stale-JWT problem — no sign-out required.

---

### 3. Welcome modal — `UpgradeSuccessModal`

**New file:** `apps/web/src/components/billing/UpgradeSuccessModal.tsx`

A standard shadcn `Dialog`. Triggered by `StripeRedirectHandler` (replaces `StripeRedirectToasts` in `org/page.tsx`).

**Trigger sequence (in `StripeRedirectHandler`):**
1. Detect `?upgraded=1` in search params
2. Call `POST /api/auth/refresh-session`
3. Call `useSession().update()` client-side to sync the new plan into the React session context
4. Open modal
5. `router.replace('/settings/org')` to strip the query param (no history entry)

**Modal contents (dynamic — derived from `PLAN_LIMITS`, not hardcoded):**

```
┌─────────────────────────────────────┐
│  ✓  You're on {Plan}                │
│                                     │
│  Here's what's unlocked:            │
│  • {N} machines  (was {prev})       │
│  • Unlimited sessions               │
│  • {N} days session history         │
│  • Webhooks & API access            │
│                                     │
│  [ Add Your First Machine → ]  ←primary│
│  [ Maybe later ]               ←ghost  │
└─────────────────────────────────────┘
```

- Plan name read from `useSession()` after refresh
- Limits read from `PLAN_LIMITS[plan]`
- "Add Your First Machine →" → `router.push('/machines')` + close modal
- "Maybe later" → close modal only
- Works for Pro, Team, and Enterprise upgrades without code changes

---

### 4. Welcome email

**File:** `apps/web/src/app/api/webhooks/stripe/route.ts`

Fired inside `checkout.session.completed`, after `updatePlanForUser()` succeeds.

Uses Resend + existing dark HTML template pattern (same as `invoice.payment_failed` email).

**Subject:** `Your SessionForge {Plan} subscription is confirmed`

**Body:**
- Plan name
- 3 key unlocked limits (machines, sessions, history days)
- Single CTA button: "Go to Dashboard" → `{appUrl}/dashboard`
- No upsell copy

**Failure handling:** `.catch((err) => logger.error(...))` — email failure never throws or retries inline, never affects webhook `200`.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/app/api/webhooks/stripe/route.ts` | Save `stripeSubscriptionId`; add welcome email |
| `apps/web/src/app/api/auth/refresh-session/route.ts` | New — session refresh endpoint |
| `apps/web/src/components/billing/UpgradeSuccessModal.tsx` | New — welcome modal component |
| `apps/web/src/app/(dashboard)/settings/org/page.tsx` | Replace `StripeRedirectToasts` with `StripeRedirectHandler` |

---

## Out of Scope

- Confetti / animations
- Dedicated `/welcome` page (Option C)
- Downgrade flow
- Trial handling
