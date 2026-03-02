import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { router, protectedProcedure } from '../trpc'
import { db, users, organizations } from '@/db'
import { PLAN_PRICES } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

// Guard: surface billing misconfiguration early rather than silently passing
// stub values to Stripe (which would cause cryptic API errors at runtime).
function requireBillingConfig(): {
  stripe: Stripe
  priceIds: Record<Exclude<PlanTier, 'free' | 'enterprise'>, string>
} {
  const secretKey = process.env.STRIPE_SECRET_KEY
  // Accept both naming conventions: STRIPE_PRO_PRICE_ID (deploy YAML) and STRIPE_PRICE_PRO (legacy)
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID ?? process.env.STRIPE_PRICE_PRO
  const teamPriceId = process.env.STRIPE_TEAM_PRICE_ID ?? process.env.STRIPE_PRICE_TEAM

  if (
    !secretKey ||
    !proPriceId ||
    proPriceId === 'price_pro_stub' ||
    !teamPriceId ||
    teamPriceId === 'price_team_stub'
  ) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Billing is not configured',
    })
  }

  return {
    stripe: new Stripe(secretKey, { apiVersion: '2024-04-10' }),
    priceIds: { pro: proPriceId, team: teamPriceId },
  }
}

// Module-level Stripe client used only by getSubscription (read-only, no price IDs needed).
// createCheckout and createPortalSession call requireBillingConfig() to validate all vars.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2024-04-10',
})

export const billingRouter = router({
  /** Get the current subscription status for the authenticated user */
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await db
      .select({
        id: users.id,
        plan: users.plan,
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
    }

    let subscription: Stripe.Subscription | null = null

    if (user.stripeCustomerId) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          status: 'active',
          limit: 1,
        })
        subscription = subs.data[0] ?? null
      } catch (err) {
        // STUB: Log to monitoring - don't throw so UI still loads
        console.error('[billing] failed to fetch Stripe subscription:', err)
      }
    }

    return {
      plan: user.plan as PlanTier,
      stripeCustomerId: user.stripeCustomerId,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          }
        : null,
      prices: PLAN_PRICES,
    }
  }),

  /** Create a Stripe Checkout session to subscribe to a paid plan */
  createCheckout: protectedProcedure
    .input(
      z.object({
        plan: z.enum(['pro', 'team']),
        orgId: z.string().uuid().optional(),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { stripe: billingStripe, priceIds } = requireBillingConfig()

      const [user] = await db
        .select({ id: users.id, email: users.email, stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1)

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })
      }

      // Get or create Stripe customer
      let customerId = user.stripeCustomerId

      if (!customerId) {
        const customer = await billingStripe.customers.create({
          email: user.email,
          metadata: { userId: user.id },
        })
        customerId = customer.id

        await db
          .update(users)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(users.id, user.id))
      }

      const priceId = priceIds[input.plan]
      if (!priceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `No Stripe price configured for plan: ${input.plan}`,
        })
      }

      const checkoutSession = await billingStripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: {
          userId: user.id,
          plan: input.plan,
          orgId: input.orgId ?? '',
        },
        subscription_data: {
          metadata: {
            userId: user.id,
            plan: input.plan,
          },
        },
        allow_promotion_codes: true,
      })

      return { url: checkoutSession.url }
    }),

  /** Create a Stripe Customer Portal session for managing subscription */
  createPortalSession: protectedProcedure
    .input(
      z.object({
        returnUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [user] = await db
        .select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1)

      if (!user?.stripeCustomerId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No billing account found. Please subscribe to a plan first.',
        })
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: input.returnUrl,
      })

      return { url: portalSession.url }
    }),
})
