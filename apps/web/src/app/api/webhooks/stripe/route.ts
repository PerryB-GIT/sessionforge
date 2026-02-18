import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { db, users, organizations } from '@/db'
import type { PlanTier } from '@sessionforge/shared-types'

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
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed:', err)
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
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
        if (customerId && userId) {
          await db.update(users).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(users.id, userId))
        }

        await updatePlanForUser(userId, plan as PlanTier, orgId || null)
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const { userId, plan, orgId } = subscription.metadata ?? {}
        if (!userId || !plan) break

        // Only update if subscription is active
        if (subscription.status === 'active' || subscription.status === 'trialing') {
          await updatePlanForUser(userId, plan as PlanTier, orgId || null)
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
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
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
            await resend.emails.send({
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
            }).catch((err) => console.error('[stripe/webhook] failed to send payment failure email:', err))
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
    console.error('[stripe/webhook] error processing event:', event.type, err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

async function updatePlanForUser(userId: string, plan: PlanTier, orgId: string | null) {
  if (orgId) {
    await db
      .update(organizations)
      .set({ plan, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
  } else {
    await db
      .update(users)
      .set({ plan, updatedAt: new Date() })
      .where(eq(users.id, userId))
  }
}
