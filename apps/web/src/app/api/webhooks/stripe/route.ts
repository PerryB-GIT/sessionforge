import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
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
        // STUB: Send payment failure email to customer
        console.warn('[stripe/webhook] payment failed for customer:', invoice.customer)
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
