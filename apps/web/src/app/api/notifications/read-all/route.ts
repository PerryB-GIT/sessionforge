export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { eq, isNull, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, notifications } from '@/db'
import type { ApiError } from '@sessionforge/shared-types'

export async function POST() {
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

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)))

  return NextResponse.json({ data: { ok: true }, error: null })
}
