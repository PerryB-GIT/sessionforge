import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/db'
import { users } from '@/db/schema'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

export async function POST(_req: NextRequest): Promise<NextResponse<ApiResponse<{ ok: boolean }> | ApiError>> {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated', statusCode: 401 },
      } satisfies ApiError,
      { status: 401 }
    )
  }

  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date() })
    .where(eq(users.id, session.user.id))

  return NextResponse.json(
    { data: { ok: true }, error: null } satisfies ApiResponse<{ ok: boolean }>,
    { status: 200 }
  )
}
