export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq, desc } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, sessionTemplates } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

// ─── GET /api/session-templates ────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
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

  const rows = await db
    .select()
    .from(sessionTemplates)
    .where(eq(sessionTemplates.userId, session.user.id))
    .orderBy(desc(sessionTemplates.createdAt))

  return NextResponse.json({ data: rows, error: null } satisfies ApiResponse<typeof rows>, {
    status: 200,
  })
}

// ─── POST /api/session-templates ───────────────────────────────────────────────

const createTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  machineId: z.string().uuid().optional(),
  command: z.string().min(1, 'Command is required').default('claude'),
  workdir: z.string().optional(),
})

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

  const body = await req.json()
  const parsed = createTemplateSchema.safeParse(body)

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

  const { name, machineId, command, workdir } = parsed.data

  const [template] = await db
    .insert(sessionTemplates)
    .values({
      userId: session.user.id,
      name,
      machineId: machineId ?? null,
      command,
      workdir: workdir ?? null,
    })
    .returning()

  if (!template) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create template',
          statusCode: 500,
        },
      } satisfies ApiError,
      { status: 500 }
    )
  }

  return NextResponse.json({ data: template, error: null } satisfies ApiResponse<typeof template>, {
    status: 201,
  })
}
