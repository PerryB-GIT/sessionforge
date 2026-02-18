import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, users } from '@/db'

export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2024-04-10',
})

const PRICE_IDS: Record<string, string | undefined> = {
  pro: process.env.STRIPE_PRICE_PRO,
  team: process.env.STRIPE_PRICE_TEAM,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { plan } = await req.json()
  const priceId = PRICE_IDS[plan]

  if (!priceId) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const appUrl = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'

  // Look up or reuse existing Stripe customer ID so billing portal works after checkout
  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  let customerId = user?.stripeCustomerId ?? undefined

  if (!customerId && user?.email) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: session.user.id },
    })
    customerId = customer.id
    await db.update(users).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(users.id, session.user.id))
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/settings/org?upgraded=1`,
    cancel_url: `${appUrl}/settings/org?canceled=1`,
    customer: customerId,
    metadata: {
      userId: session.user.id,
      plan,
    },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
