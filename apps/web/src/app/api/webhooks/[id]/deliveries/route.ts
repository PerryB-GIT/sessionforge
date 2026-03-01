import { NextRequest, NextResponse } from 'next/server'
import { eq, and, desc } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, webhooks, webhookDeliveries } from '@/db'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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

  // Verify ownership
  const [webhook] = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.id, params.id), eq(webhooks.userId, session.user.id)))
    .limit(1)

  if (!webhook) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Webhook not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, params.id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50)

  return NextResponse.json({ data: deliveries, error: null } satisfies ApiResponse<
    typeof deliveries
  >)
}
