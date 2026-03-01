import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db, ssoConfigs, organizations, orgMembers } from '@/db'
import { isFeatureAvailable } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

const upsertSchema = z.object({
  provider: z.enum(['oidc', 'saml']),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  issuerUrl: z.string().url().optional().or(z.literal('')),
  samlIdpMetadataUrl: z.string().url().optional().or(z.literal('')),
  enabled: z.boolean().optional(),
})

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

  const [membership] = await db
    .select({ orgId: orgMembers.orgId, plan: organizations.plan })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1)

  if (!membership || !isFeatureAvailable(membership.plan as PlanTier, 'sso')) {
    return NextResponse.json({ data: null, error: null })
  }

  const [config] = await db
    .select({
      id: ssoConfigs.id,
      provider: ssoConfigs.provider,
      clientId: ssoConfigs.clientId,
      issuerUrl: ssoConfigs.issuerUrl,
      samlIdpMetadataUrl: ssoConfigs.samlIdpMetadataUrl,
      enabled: ssoConfigs.enabled,
    })
    .from(ssoConfigs)
    .where(eq(ssoConfigs.orgId, membership.orgId))
    .limit(1)

  // clientSecret intentionally omitted from GET response
  return NextResponse.json({ data: config ?? null, error: null } satisfies ApiResponse<
    typeof config | null
  >)
}

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

  const [membership] = await db
    .select({ orgId: orgMembers.orgId, plan: organizations.plan, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, session.user.id))
    .limit(1)

  if (
    !membership ||
    !isFeatureAvailable(membership.plan as PlanTier, 'sso') ||
    membership.role !== 'owner'
  ) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'FORBIDDEN',
          message: 'Requires Enterprise plan and owner role',
          statusCode: 403,
        },
      } satisfies ApiError,
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0].message,
          statusCode: 400,
        },
      } satisfies ApiError,
      { status: 400 }
    )
  }

  const data = parsed.data

  const existing = await db
    .select({ id: ssoConfigs.id })
    .from(ssoConfigs)
    .where(eq(ssoConfigs.orgId, membership.orgId))
    .limit(1)

  if (existing.length > 0) {
    // Build typed update payload — Partial<typeof ssoConfigs.$inferInsert> gives
    // compile-time column validation (no unknown key typos slip through).
    if (data.provider === 'oidc') {
      const oidcUpdate: Partial<typeof ssoConfigs.$inferInsert> = {
        provider: 'oidc',
        enabled: data.enabled ?? false,
        clientId: data.clientId ?? null,
        issuerUrl: data.issuerUrl || null,
        samlIdpMetadataUrl: null,
        updatedAt: new Date(),
      }
      // Only overwrite clientSecret when a new value is supplied
      if (data.clientSecret) oidcUpdate.clientSecret = data.clientSecret
      await db.update(ssoConfigs).set(oidcUpdate).where(eq(ssoConfigs.orgId, membership.orgId))
    } else {
      await db
        .update(ssoConfigs)
        .set({
          provider: 'saml',
          enabled: data.enabled ?? false,
          samlIdpMetadataUrl: data.samlIdpMetadataUrl || null,
          clientId: null,
          issuerUrl: null,
          clientSecret: null,
          updatedAt: new Date(),
        } satisfies Partial<typeof ssoConfigs.$inferInsert>)
        .where(eq(ssoConfigs.orgId, membership.orgId))
    }
  } else {
    await db.insert(ssoConfigs).values({
      orgId: membership.orgId,
      provider: data.provider,
      clientId: data.clientId ?? null,
      clientSecret: data.clientSecret ?? null,
      issuerUrl: data.issuerUrl || null,
      samlIdpMetadataUrl: data.samlIdpMetadataUrl || null,
      enabled: data.enabled ?? false,
    })
  }

  return NextResponse.json({ data: { ok: true }, error: null })
}
