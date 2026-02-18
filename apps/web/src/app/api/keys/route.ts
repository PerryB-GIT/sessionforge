export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, apiKeys } from '@/db'
import { generateApiKey } from '@/lib/api-keys'
import type { ApiResponse, ApiError } from '@sessionforge/shared-types'

const createKeySchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.string()).default(['read', 'write']),
  orgId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
})

// ─── GET /api/keys ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
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
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      orgId: apiKeys.orgId,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, session.user.id))
    .orderBy(apiKeys.createdAt)

  return NextResponse.json(
    { data: rows, error: null } satisfies ApiResponse<typeof rows>,
    { status: 200 }
  )
}

// ─── POST /api/keys ────────────────────────────────────────────────────────────

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
  const parsed = createKeySchema.safeParse(body)

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

  const { name, scopes, orgId, expiresAt } = parsed.data
  const { key, hash, prefix } = generateApiKey()

  const [created] = await db
    .insert(apiKeys)
    .values({
      userId: session.user.id,
      orgId: orgId ?? null,
      name,
      keyHash: hash,
      keyPrefix: prefix,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
    })

  if (!created) {
    return NextResponse.json(
      {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create API key', statusCode: 500 },
      } satisfies ApiError,
      { status: 500 }
    )
  }

  // Return the full key ONLY once at creation time
  return NextResponse.json(
    {
      data: { ...created, key },
      error: null,
    } satisfies ApiResponse<typeof created & { key: string }>,
    { status: 201 }
  )
}
