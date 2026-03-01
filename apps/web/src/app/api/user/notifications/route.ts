export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, users } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

const DEFAULT_PREFS = {
  sessionCrashed: true,
  machineOffline: true,
  sessionStarted: false,
  weeklyDigest: true,
}

const prefsSchema = z.object({
  sessionCrashed: z.boolean(),
  machineOffline: z.boolean(),
  sessionStarted: z.boolean(),
  weeklyDigest: z.boolean(),
})

type NotificationPrefs = z.infer<typeof prefsSchema>

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

  const [user] = await db
    .select({ notificationPreferences: users.notificationPreferences })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  const prefs: NotificationPrefs =
    (user?.notificationPreferences as NotificationPrefs) ?? DEFAULT_PREFS

  return NextResponse.json({ data: prefs, error: null } satisfies ApiResponse<NotificationPrefs>)
}

export async function PATCH(req: NextRequest) {
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

  const body = await req.json().catch(() => null)
  const parsed = prefsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid request body',
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  await db
    .update(users)
    .set({ notificationPreferences: parsed.data, updatedAt: new Date() })
    .where(eq(users.id, session.user.id))

  return NextResponse.json({
    data: parsed.data,
    error: null,
  } satisfies ApiResponse<NotificationPrefs>)
}
