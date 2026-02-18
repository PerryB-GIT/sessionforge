import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers } from '@/db'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const createOrgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(255),
})

// ─── POST /api/orgs ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const body = await req.json()
  const parsed = createOrgSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input', statusCode: 400 } } satisfies ApiError,
      { status: 400 }
    )
  }

  const { name } = parsed.data

  // Generate slug from name
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)

  // Ensure slug uniqueness by appending random suffix if taken
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1)

  if (existing) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
  }

  const [org] = await db
    .insert(organizations)
    .values({ name, slug, ownerId: session.user.id })
    .returning()

  if (!org) {
    return NextResponse.json(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create organization', statusCode: 500 } } satisfies ApiError,
      { status: 500 }
    )
  }

  // Add creator as owner member
  await db.insert(orgMembers).values({ orgId: org.id, userId: session.user.id, role: 'owner' })

  return NextResponse.json(
    { data: org, error: null } satisfies ApiResponse<typeof org>,
    { status: 201 }
  )
}
