# Post-Purchase Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After a user completes Stripe checkout, immediately show them a welcome modal with their new plan limits and a CTA to add a machine, while fixing the stale-JWT bug and missing subscription ID.

**Architecture:** Four coordinated changes: (1) webhook saves `stripeSubscriptionId` + sends welcome email, (2) new `/api/auth/refresh-session` POST endpoint forces JWT refresh, (3) `UpgradeSuccessModal` component shown when `?upgraded=1` is in the URL, (4) `StripeRedirectHandler` replaces the existing `StripeRedirectToasts` in `org/page.tsx` and orchestrates the refresh + modal open sequence.

**Tech Stack:** Next.js App Router, NextAuth v5 beta, Drizzle ORM, Resend, shadcn Dialog, Zod (already installed — no new deps)

---

## Context to Read Before Starting

- `apps/web/src/app/api/webhooks/stripe/route.ts` — webhook handler (Tasks 1 + 2)
- `apps/web/src/lib/auth.ts:165-191` — JWT callback, already handles `trigger: 'update'` to update `token.plan`
- `apps/web/src/app/(dashboard)/settings/org/page.tsx:30-41` — `StripeRedirectToasts` component being replaced
- `packages/shared-types/src/plans.ts` — `PLAN_LIMITS` and `PlanTier` used in modal
- `apps/web/src/components/billing/UpgradePrompt.tsx` — existing billing component for style reference

---

## Task 1: Save `stripeSubscriptionId` in webhook

**Files:**
- Modify: `apps/web/src/app/api/webhooks/stripe/route.ts:48-63`

**Step 1: Open the file and find the `checkout.session.completed` case**

It's at line 48. The existing code saves `stripeCustomerId` and calls `updatePlanForUser()`. We need to also save `stripeSubscriptionId` on the org (if `orgId` is present) or skip (users table has no subscription ID column — it lives on organizations only).

**Step 2: Add subscription ID save after the customerId save**

Replace the existing `checkout.session.completed` block:

```typescript
case 'checkout.session.completed': {
  const session = event.data.object as Stripe.Checkout.Session
  if (session.mode !== 'subscription') break

  const { userId, plan, orgId } = session.metadata ?? {}
  if (!userId || !plan) break

  // Save stripeCustomerId so the billing portal can be opened
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  if (customerId && userId) {
    await db.update(users).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(users.id, userId))
  }

  // Save stripeSubscriptionId on the org so subscription management works
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  if (subscriptionId && orgId) {
    await db.update(organizations).set({ stripeSubscriptionId: subscriptionId, updatedAt: new Date() }).where(eq(organizations.id, orgId))
  }

  await updatePlanForUser(userId, plan as PlanTier, orgId || null)
  break
}
```

**Step 3: Verify it compiles**

```bash
cd C:/Users/Jakeb/sessionforge
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -i "webhooks/stripe"
```

Expected: no errors for that file.

**Step 4: Commit**

```bash
git add apps/web/src/app/api/webhooks/stripe/route.ts
git commit -m "fix: save stripeSubscriptionId in checkout.session.completed webhook"
```

---

## Task 2: Add welcome email to webhook

**Files:**
- Modify: `apps/web/src/app/api/webhooks/stripe/route.ts`

**Step 1: After `updatePlanForUser()` in `checkout.session.completed`, fetch the user's email and send the welcome email**

Add this block immediately after the `await updatePlanForUser(...)` line, before `break`:

```typescript
// Send welcome email
try {
  const [upgradeUser] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (upgradeUser) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const appUrl = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
    const planLabel = (plan.charAt(0).toUpperCase() + plan.slice(1)) as string
    const limits = PLAN_LIMITS[plan as PlanTier]
    const machineLabel = limits.machines === -1 ? 'Unlimited' : String(limits.machines)
    const historyLabel = limits.historyDays === 365 ? '1 year' : `${limits.historyDays} days`
    const displayName = upgradeUser.name ?? upgradeUser.email

    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'noreply@sessionforge.dev',
      to: upgradeUser.email,
      subject: `Your SessionForge ${planLabel} subscription is confirmed`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid #27272a">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Session<span style="color:#8b5cf6">Forge</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px">
            <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff">You're on ${planLabel}</p>
            <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;line-height:1.6">
              Hi ${displayName}, your ${planLabel} subscription is active. Here's what's unlocked:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #27272a;font-size:13px;color:#a1a1aa">Machines</td>
                <td style="padding:8px 0;border-bottom:1px solid #27272a;font-size:13px;color:#ffffff;text-align:right">${machineLabel}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #27272a;font-size:13px;color:#a1a1aa">Concurrent sessions</td>
                <td style="padding:8px 0;border-bottom:1px solid #27272a;font-size:13px;color:#ffffff;text-align:right">Unlimited</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#a1a1aa">Session history</td>
                <td style="padding:8px 0;font-size:13px;color:#ffffff;text-align:right">${historyLabel}</td>
              </tr>
            </table>
            <a href="${appUrl}/dashboard"
               style="display:block;text-align:center;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px">
              Go to Dashboard
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #27272a">
            <p style="margin:0;font-size:12px;color:#3f3f46">SessionForge LLC · <a href="${appUrl}/settings/org" style="color:#3f3f46">Manage subscription</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    })
  }
} catch (emailErr) {
  logger.error('Stripe webhook: welcome email send failed', { error: String(emailErr) })
}
```

**Step 2: Verify `PLAN_LIMITS` is imported at the top of the webhook file**

The file already imports from `@sessionforge/shared-types` for `PlanTier`. Add `PLAN_LIMITS` to that import:

```typescript
import type { PlanTier } from '@sessionforge/shared-types'
import { PLAN_LIMITS } from '@sessionforge/shared-types'
```

**Step 3: Verify it compiles**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -i "webhooks/stripe"
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/web/src/app/api/webhooks/stripe/route.ts
git commit -m "feat: send welcome email on checkout.session.completed"
```

---

## Task 3: Create `/api/auth/refresh-session` endpoint

**Files:**
- Create: `apps/web/src/app/api/auth/refresh-session/route.ts`

**Step 1: Understand how server-side session update works in NextAuth v5**

In NextAuth v5 beta, `auth()` gives you the current session. To force a JWT re-read on the client after a server-side plan update, the client calls `useSession().update()` — this hits the JWT callback with `trigger: 'update'`. The `auth.ts` JWT callback at line 185-188 already handles this: if `trigger === 'update'` and `session.plan` is passed, it updates `token.plan`.

So this endpoint just needs to: verify auth, then return `{ ok: true }`. The actual JWT update happens when the client calls `useSession().update({ plan: newPlan })` after getting the new plan from this endpoint.

**Step 2: Create the file**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, users } from '@/db'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [user] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  return NextResponse.json({ ok: true, plan: user?.plan ?? 'free' })
}
```

**Step 3: Verify it compiles**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -i "refresh-session"
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/web/src/app/api/auth/refresh-session/route.ts
git commit -m "feat: add /api/auth/refresh-session endpoint"
```

---

## Task 4: Build `UpgradeSuccessModal` component

**Files:**
- Create: `apps/web/src/components/billing/UpgradeSuccessModal.tsx`

**Step 1: Check available shadcn Dialog imports**

They're already used in `org/page.tsx`:
```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
```

Also note `CheckCircle2`, `ArrowRight` from `lucide-react` are available.

**Step 2: Create the modal component**

```typescript
'use client'

import { useRouter } from 'next/navigation'
import { CheckCircle2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PLAN_LIMITS } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

interface UpgradeSuccessModalProps {
  open: boolean
  onClose: () => void
  plan: PlanTier
}

export function UpgradeSuccessModal({ open, onClose, plan }: UpgradeSuccessModalProps) {
  const router = useRouter()
  const limits = PLAN_LIMITS[plan]
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1)

  const machineLabel = limits.machines === -1 ? 'Unlimited' : `${limits.machines}`
  const historyLabel = limits.historyDays === 365 ? '1 year' : `${limits.historyDays} days`

  function handleAddMachine() {
    onClose()
    router.push('/machines')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <DialogTitle>You're on {planLabel}</DialogTitle>
          </div>
          <DialogDescription>
            Here's what's unlocked on your new plan:
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 py-2">
          <li className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Machines</span>
            <span className="text-white font-medium">{machineLabel}</span>
          </li>
          <li className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Concurrent sessions</span>
            <span className="text-white font-medium">Unlimited</span>
          </li>
          <li className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Session history</span>
            <span className="text-white font-medium">{historyLabel}</span>
          </li>
          {plan !== 'free' && (
            <li className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Webhooks & API access</span>
              <span className="text-white font-medium">Enabled</span>
            </li>
          )}
        </ul>

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={handleAddMachine} className="w-full">
            Add Your First Machine
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-gray-400">
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 3: Verify it compiles**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -i "UpgradeSuccessModal"
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/web/src/components/billing/UpgradeSuccessModal.tsx
git commit -m "feat: add UpgradeSuccessModal component"
```

---

## Task 5: Wire up `StripeRedirectHandler` in `org/page.tsx`

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/org/page.tsx:1-41`

**Step 1: Understand what exists**

`StripeRedirectToasts` (lines 30-41) currently reads `?upgraded=1` and fires a toast. We're replacing it with `StripeRedirectHandler` that: calls the refresh endpoint, calls `useSession().update()`, then opens the modal.

**Step 2: Add imports at the top of `org/page.tsx`**

Add to the existing import block:
```typescript
import { useCallback } from 'react'  // add to existing React imports
import { UpgradeSuccessModal } from '@/components/billing/UpgradeSuccessModal'
import type { PlanTier } from '@sessionforge/shared-types'
```

**Step 3: Replace `StripeRedirectToasts` with `StripeRedirectHandler`**

Delete lines 30-41 (the `StripeRedirectToasts` function) and replace with:

```typescript
function StripeRedirectHandler({
  onUpgradeDetected,
}: {
  onUpgradeDetected: (plan: PlanTier) => void
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { update } = useSession()

  useEffect(() => {
    if (searchParams.get('upgraded') !== '1') return

    // Strip query param immediately so refresh doesn't re-trigger
    router.replace('/settings/org')

    // Fetch fresh plan from DB, push into JWT, then open modal
    fetch('/api/auth/refresh-session', { method: 'POST' })
      .then((r) => r.json())
      .then(async (data) => {
        if (data.plan) {
          await update({ plan: data.plan })
          onUpgradeDetected(data.plan as PlanTier)
        }
      })
      .catch(() => {
        // Fallback: show modal anyway with plan from current session
        onUpgradeDetected('pro')
      })

    if (searchParams.get('canceled') === '1') {
      toast.info('Checkout canceled. Your plan has not changed.')
    }
  }, [searchParams, router, update, onUpgradeDetected])

  return null
}
```

**Step 4: Add modal state to `OrgSettingsPage` and wire it up**

Inside `OrgSettingsPage`, add state:
```typescript
const [upgradedPlan, setUpgradedPlan] = useState<PlanTier | null>(null)
```

Add a stable callback:
```typescript
const handleUpgradeDetected = useCallback((plan: PlanTier) => {
  setUpgradedPlan(plan)
}, [])
```

**Step 5: Replace the `<StripeRedirectToasts />` JSX with the new components**

Replace:
```tsx
<Suspense>
  <StripeRedirectToasts />
</Suspense>
```

With:
```tsx
<Suspense>
  <StripeRedirectHandler onUpgradeDetected={handleUpgradeDetected} />
</Suspense>
<UpgradeSuccessModal
  open={upgradedPlan !== null}
  onClose={() => setUpgradedPlan(null)}
  plan={upgradedPlan ?? 'pro'}
/>
```

**Step 6: Verify it compiles**

```bash
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -i "settings/org"
```

Expected: no errors.

**Step 7: Commit**

```bash
git add apps/web/src/app/(dashboard)/settings/org/page.tsx
git commit -m "feat: replace StripeRedirectToasts with StripeRedirectHandler and UpgradeSuccessModal"
```

---

## Task 6: Deploy and verify end-to-end

**Step 1: Build locally to catch any remaining errors**

```bash
cd C:/Users/Jakeb/sessionforge/apps/web
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` with no type errors.

**Step 2: Deploy to Cloud Run**

```bash
cd C:/Users/Jakeb/sessionforge
gcloud run services update sessionforge \
  --project=sessionforge-487719 \
  --region=us-central1 \
  --source=. \
  2>&1 | tail -5
```

Wait for: `Service [sessionforge] revision [sessionforge-XXXXX] has been deployed and is serving 100 percent of traffic.`

**Step 3: Manually verify the modal**

Navigate to `https://sessionforge.dev/settings/org?upgraded=1` while logged in as `qa-test@sessionforge.dev`.

Expected:
- URL immediately changes to `/settings/org` (param stripped)
- Modal appears: "You're on Pro" (or whatever plan is in DB)
- Machine count, sessions, history shown correctly
- "Add Your First Machine" button navigates to `/machines`
- "Maybe later" closes modal cleanly
- Plan badge in sidebar reflects new plan (not stale "Free")

**Step 4: Verify welcome email via Resend dashboard**

Check `https://resend.com/emails` for a sent email to `qa-test@sessionforge.dev` with subject matching `Your SessionForge Pro subscription is confirmed`.

**Step 5: Verify `stripeSubscriptionId` saved**

```bash
# Check via Cloud Run logs or direct DB query
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=sessionforge AND textPayload:\"checkout.session.completed\"" \
  --project=sessionforge-487719 --limit=5 --format="table(timestamp,textPayload)"
```

---

## Summary of all changed files

| File | Type | What changed |
|------|------|-------------|
| `apps/web/src/app/api/webhooks/stripe/route.ts` | Modified | Save `stripeSubscriptionId`; send welcome email |
| `apps/web/src/app/api/auth/refresh-session/route.ts` | Created | POST endpoint: returns fresh plan from DB |
| `apps/web/src/components/billing/UpgradeSuccessModal.tsx` | Created | Welcome modal with plan limits + Add Machine CTA |
| `apps/web/src/app/(dashboard)/settings/org/page.tsx` | Modified | Replace `StripeRedirectToasts` with `StripeRedirectHandler` + modal |
