import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, apiKeys } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── DELETE /api/keys/:id ──────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

  const { id } = params

  const [deleted] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, session.user.id)))
    .returning({ id: apiKeys.id })

  if (!deleted) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'API key not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json(
    { data: { id: deleted.id, revoked: true }, error: null } satisfies ApiResponse<{
      id: string
      revoked: boolean
    }>,
    { status: 200 }
  )
}
