import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, organizations } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

// ─── GET /api/org ──────────────────────────────────────────────────────────────
// Returns the first org owned by the authenticated user.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.ownerId, session.user.id))
    .limit(1)

  if (!org) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'No organization found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json({ data: org, error: null } satisfies ApiResponse<typeof org>)
}

// ─── PATCH /api/org ────────────────────────────────────────────────────────────

const patchSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens').optional(),
})

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input', statusCode: 400 } } satisfies ApiError,
      { status: 400 }
    )
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'No fields to update', statusCode: 400 } } satisfies ApiError,
      { status: 400 }
    )
  }

  // Verify slug uniqueness if changing it
  if (updates.slug) {
    const [conflict] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, updates.slug))
      .limit(1)

    if (conflict) {
      return NextResponse.json(
        { data: null, error: { code: 'CONFLICT', message: 'That URL slug is already taken', statusCode: 409 } } satisfies ApiError,
        { status: 409 }
      )
    }
  }

  const [updated] = await db
    .update(organizations)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(organizations.ownerId, session.user.id))
    .returning()

  if (!updated) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'No organization found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json({ data: updated, error: null } satisfies ApiResponse<typeof updated>)
}
