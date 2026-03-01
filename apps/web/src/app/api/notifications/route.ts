export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { eq, isNull, desc, count, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, notifications } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

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

  const userId = session.user.id

  const [items, unreadResult] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(20),
    db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ])

  const unreadCount = unreadResult[0]?.count ?? 0

  return NextResponse.json({
    data: { items, unreadCount },
    error: null,
  } satisfies ApiResponse<{ items: typeof items; unreadCount: number }>)
}
