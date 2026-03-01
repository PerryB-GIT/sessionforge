import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, webhooks, users } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import { generateWebhookSecret } from '@/lib/webhook-delivery'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const VALID_EVENTS = [
  'session.started',
  'session.stopped',
  'session.crashed',
  'machine.online',
  'machine.offline',
  '*',
] as const

const createSchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048),
  events: z.array(z.enum(VALID_EVENTS)).min(1, 'Select at least one event'),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  const items = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      enabled: webhooks.enabled,
      createdAt: webhooks.createdAt,
    })
    .from(webhooks)
    .where(eq(webhooks.userId, session.user.id))
    .orderBy(webhooks.createdAt)

  return NextResponse.json({ data: items, error: null } satisfies ApiResponse<typeof items>)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  // Plan gate
  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  const plan = (userRow?.plan ?? 'free') as PlanTier
  if (!isFeatureAvailable(plan, 'webhooks')) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'PLAN_LIMIT',
          message: 'Webhooks require a Pro plan or above',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0].message,
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  const secret = generateWebhookSecret()

  const [created] = await db
    .insert(webhooks)
    .values({
      userId: session.user.id,
      url: parsed.data.url,
      events: parsed.data.events as string[],
      secret,
    })
    .returning()

  // Return secret only once at creation time
  return NextResponse.json({ data: { ...created, secret }, error: null }, { status: 201 })
}
