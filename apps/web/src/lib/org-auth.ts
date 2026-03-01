import { eq, and } from 'drizzle-orm'
import { db, orgMembers } from '@/db'
import type { Session } from 'next-auth'

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'

const ROLE_RANK: Record<MemberRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

export class OrgAuthError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'OrgAuthError'
  }
}

/**
 * Throws an OrgAuthError if the authenticated user does not have
 * at least `minRole` in the given org. Otherwise returns the user's role.
 */
export async function requireOrgRole(
  session: Session | null,
  orgId: string,
  minRole: MemberRole
): Promise<MemberRole> {
  if (!session?.user?.id) {
    throw new OrgAuthError('Authentication required', 401, 'UNAUTHORIZED')
  }

  const [membership] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, session.user.id)))
    .limit(1)

  if (!membership) {
    throw new OrgAuthError('You are not a member of this organization', 403, 'FORBIDDEN')
  }

  const userRank = ROLE_RANK[membership.role as MemberRole] ?? -1
  const requiredRank = ROLE_RANK[minRole]

  if (userRank < requiredRank) {
    throw new OrgAuthError(
      `This action requires ${minRole} role or above`,
      403,
      'INSUFFICIENT_ROLE'
    )
  }

  return membership.role as MemberRole
}

/** Convert an OrgAuthError into a response-compatible error object */
export function orgAuthErrorResponse(err: unknown): {
  status: number
  code: string
  message: string
} {
  if (err instanceof OrgAuthError) {
    return { status: err.status, code: err.code, message: err.message }
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
}
