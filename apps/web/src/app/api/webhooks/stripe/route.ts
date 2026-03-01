import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { db, users, organizations } from '@/db'
import type { PlanTier } from '@sessionforge/shared-types'
import { PLAN_LIMITS } from '@sessionforge/shared-types'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

// STUB: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set in environment
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2024-04-10',
})

/**
 * Stripe webhook handler - updates user/org plan when subscription changes.
 *
 * Events handled:
 *   - checkout.session.completed     → provision plan after payment
 *   - customer.subscription.updated  → plan change
 *   - customer.subscription.deleted  → downgrade to free
 *   - invoice.payment_failed         → alert user
 */
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', { error: String(err) })
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break

        const { userId, plan, orgId } = session.metadata ?? {}
        if (!userId || !plan) break

        // Save stripeCustomerId so the billing portal can be opened
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id
        if (customerId && userId) {
          await db
            .update(users)
            .set({ stripeCustomerId: customerId, updatedAt: new Date() })
            .where(eq(users.id, userId))
        }

        // Save stripeSubscriptionId on the org so subscription management works
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
        if (subscriptionId && orgId) {
          await db
            .update(organizations)
            .set({ stripeSubscriptionId: subscriptionId, updatedAt: new Date() })
            .where(eq(organizations.id, orgId))
        }

        await updatePlanForUser(userId, plan as PlanTier, orgId || null)

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
            const historyLabel =
              limits.historyDays === 365 ? '1 year' : `${limits.historyDays} days`
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

        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const { userId, orgId } = subscription.metadata ?? {}
        if (!userId) break

        // Only update if subscription is active
        if (subscription.status === 'active' || subscription.status === 'trialing') {
          // Derive plan from price ID rather than metadata — the billing portal does not
          // update subscription metadata, so metadata.plan can be stale after a plan change.
          const priceId = subscription.items.data[0]?.price?.id
          const planByPriceId: Record<string, PlanTier> = {
            [process.env.STRIPE_PRO_PRICE_ID ?? '']: 'pro',
            [process.env.STRIPE_TEAM_PRICE_ID ?? '']: 'team',
            [process.env.STRIPE_ENTERPRISE_PRICE_ID ?? '']: 'enterprise',
          }
          const resolvedPlan: PlanTier =
            (priceId && planByPriceId[priceId]) ||
            (subscription.metadata?.plan as PlanTier) ||
            'pro'
          await updatePlanForUser(userId, resolvedPlan, orgId || null)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const { userId, orgId } = subscription.metadata ?? {}
        if (!userId) break

        // Downgrade to free plan
        await updatePlanForUser(userId, 'free', orgId || null)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        if (customerId) {
          const [user] = await db
            .select({ id: users.id, email: users.email, name: users.name })
            .from(users)
            .where(eq(users.stripeCustomerId, customerId))
            .limit(1)
          if (user) {
            const resend = new Resend(process.env.RESEND_API_KEY)
            const appUrl = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
            const displayName = user.name ?? user.email
            await resend.emails
              .send({
                from: process.env.EMAIL_FROM ?? 'noreply@sessionforge.dev',
                to: user.email,
                subject: 'Action required: SessionForge payment failed',
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
            <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#ffffff">Payment failed</p>
            <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;line-height:1.6">
              Hi ${displayName}, we were unable to process your latest payment for SessionForge.
              Please update your payment method to keep your subscription active.
            </p>
            <a href="${appUrl}/settings/org"
               style="display:block;text-align:center;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;margin-bottom:24px">
              Update Payment Method
            </a>
            <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6">
              If you believe this is an error, please contact support@sessionforge.dev.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #27272a">
            <p style="margin:0;font-size:12px;color:#3f3f46">SessionForge LLC</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
              })
              .catch((err) =>
                logger.error('Stripe webhook: payment failure email send failed', {
                  error: String(err),
                })
              )
          }
        }
        break
      }

      default:
        // Unhandled event type - not an error
        break
    }

    return NextResponse.json({ received: true }, { status: 200 })
  } catch (err) {
    logger.error('Stripe webhook handler failed', { eventType: event.type, error: String(err) })
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

async function updatePlanForUser(userId: string, plan: PlanTier, orgId: string | null) {
  // Always update the user's own plan record so JWT-based plan checks work correctly
  await db.update(users).set({ plan, updatedAt: new Date() }).where(eq(users.id, userId))

  // If the checkout was org-scoped, update the org plan as well
  if (orgId) {
    await db
      .update(organizations)
      .set({ plan, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
  }
}
