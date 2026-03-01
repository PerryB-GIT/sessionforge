import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { router, protectedProcedure } from '../trpc'
import { db, users, organizations } from '@/db'
import { PLAN_PRICES } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

// STUB: STRIPE_SECRET_KEY must be set in environment
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2024-04-10',
})

// STUB: Set Stripe Price IDs per plan in environment variables
const STRIPE_PRICE_IDS: Record<Exclude<PlanTier, 'free' | 'enterprise'>, string> = {
  pro: process.env.STRIPE_PRICE_PRO ?? 'price_pro_stub',
  team: process.env.STRIPE_PRICE_TEAM ?? 'price_team_stub',
}

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
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user.id },
        })
        customerId = customer.id

        await db.update(users).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(users.id, user.id))
      }

      const priceId = STRIPE_PRICE_IDS[input.plan]
      if (!priceId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `No Stripe price configured for plan: ${input.plan}` })
      }

      const checkoutSession = await stripe.checkout.sessions.create({
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
