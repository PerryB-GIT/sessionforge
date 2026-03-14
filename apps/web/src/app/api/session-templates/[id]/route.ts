export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, sessionTemplates } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── DELETE /api/session-templates/[id] ────────────────────────────────────────

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
    .delete(sessionTemplates)
    .where(and(eq(sessionTemplates.id, params.id), eq(sessionTemplates.userId, session.user.id)))
    .returning({ id: sessionTemplates.id })

  if (!deleted.length) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Template not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json(
    { data: { id: params.id }, error: null } satisfies ApiResponse<{ id: string }>,
    { status: 200 }
  )
}

// ─── PATCH /api/session-templates/[id] ─────────────────────────────────────────

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  command: z.string().min(1).optional(),
  workdir: z.string().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
  const parsed = updateTemplateSchema.safeParse(body)

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

  const updates: Partial<{
    name: string
    command: string
    workdir: string | null
    updatedAt: Date
  }> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.command !== undefined) updates.command = parsed.data.command
  if (parsed.data.workdir !== undefined) updates.workdir = parsed.data.workdir || null

  const [updated] = await db
    .update(sessionTemplates)
    .set(updates)
    .where(and(eq(sessionTemplates.id, params.id), eq(sessionTemplates.userId, session.user.id)))
    .returning()

  if (!updated) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Template not found', statusCode: 404 },
      } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json({ data: updated, error: null } satisfies ApiResponse<typeof updated>, {
    status: 200,
  })
}
