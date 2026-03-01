import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, webhooks } from '@/db'
import type { ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
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

  const deleted = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, params.id), eq(webhooks.userId, session.user.id)))
    .returning({ id: webhooks.id })

  if (deleted.length === 0) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Webhook not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json({ data: { ok: true }, error: null })
}
