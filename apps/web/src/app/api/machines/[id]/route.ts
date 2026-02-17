import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, machines } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── GET /api/machines/:id ─────────────────────────────────────────────────────

export async function GET(
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

  const [machine] = await db
    .select()
    .from(machines)
    .where(and(eq(machines.id, params.id), eq(machines.userId, session.user.id)))
    .limit(1)

  if (!machine) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Machine not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json(
    { data: machine, error: null } satisfies ApiResponse<typeof machine>,
    { status: 200 }
  )
}

// ─── PATCH /api/machines/:id ───────────────────────────────────────────────────

const updateSchema = z.object({
  name: z.string().min(1).max(255),
})

export async function PATCH(
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

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors[0]?.message ?? 'Invalid input',
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  const [updated] = await db
    .update(machines)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(and(eq(machines.id, params.id), eq(machines.userId, session.user.id)))
    .returning()

  if (!updated) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Machine not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json(
    { data: updated, error: null } satisfies ApiResponse<typeof updated>,
    { status: 200 }
  )
}

// ─── DELETE /api/machines/:id ──────────────────────────────────────────────────

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

  const [deleted] = await db
    .delete(machines)
    .where(and(eq(machines.id, params.id), eq(machines.userId, session.user.id)))
    .returning({ id: machines.id })

  if (!deleted) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Machine not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json(
    { data: { id: deleted.id, deregistered: true }, error: null } satisfies ApiResponse<{
      id: string
      deregistered: boolean
    }>,
    { status: 200 }
  )
}
