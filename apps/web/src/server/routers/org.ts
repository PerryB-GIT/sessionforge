import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { router, protectedProcedure } from '../trpc'
import { db, organizations, orgMembers, orgInvites, users } from '@/db'
import { requireFeature, FeatureNotAvailableError } from '@/lib/plan-enforcement'
import { randomBytes } from 'crypto'
import { sendInviteEmail } from '@/lib/email'

export const orgRouter = router({
  /** Get an organization by ID (must be a member) */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify membership
      const [membership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.id), eq(orgMembers.userId, ctx.userId)))
        .limit(1)

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of this organization' })
      }

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.id))
        .limit(1)

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' })
      }

      return { ...org, role: membership.role }
    }),

  /** Update organization name */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        slug: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input

      // Only owner or admin can update org
      const [membership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, id), eq(orgMembers.userId, ctx.userId)))
        .limit(1)

      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only org owners and admins can update organization details' })
      }

      if (Object.keys(updates).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No update fields provided' })
      }

      const [updated] = await db
        .update(organizations)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning()

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' })
      }

      return updated
    }),

  /** List org members */
  members: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify the caller is a member
      const [membership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
        .limit(1)

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of this organization' })
      }

      const members = await db
        .select({
          id: orgMembers.id,
          role: orgMembers.role,
          createdAt: orgMembers.createdAt,
          user: {
            id: users.id,
            email: users.email,
            name: users.name,
          },
        })
        .from(orgMembers)
        .innerJoin(users, eq(orgMembers.userId, users.id))
        .where(eq(orgMembers.orgId, input.orgId))
        .orderBy(orgMembers.createdAt)

      return members
    }),

  /** Invite a member to the org by email (token-based, no account required) */
  inviteMember: protectedProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        email: z.string().email().transform((e) => e.toLowerCase()),
        role: z.enum(['admin', 'member', 'viewer']).default('member'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Require team_invites feature (team plan and above)
      try {
        await requireFeature(ctx.userId, 'team_invites')
      } catch (err) {
        if (err instanceof FeatureNotAvailableError) {
          throw new TRPCError({ code: 'FORBIDDEN', message: err.message })
        }
        throw err
      }

      // Caller must be owner or admin
      const [membership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
        .limit(1)

      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only org owners and admins can invite members' })
      }

      // Cannot invite yourself
      const [caller] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1)

      if (caller?.email?.toLowerCase() === input.email) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot invite yourself' })
      }

      // Check if already an active member
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1)

      if (existingUser) {
        const [existingMember] = await db
          .select({ id: orgMembers.id })
          .from(orgMembers)
          .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, existingUser.id)))
          .limit(1)

        if (existingMember) {
          throw new TRPCError({ code: 'CONFLICT', message: 'This person is already a member of your organization' })
        }
      }

      // Fetch org name for email
      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .limit(1)

      if (!org) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' })
      }

      const token = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      // Delete all prior invites for this (orgId, email) — clears pending, expired, or accepted rows
      const invite = await db.transaction(async (tx) => {
        await tx
          .delete(orgInvites)
          .where(
            and(
              eq(orgInvites.orgId, input.orgId),
              eq(orgInvites.email, input.email),
            )
          )
        const [row] = await tx
          .insert(orgInvites)
          .values({
            orgId: input.orgId,
            email: input.email,
            token,
            role: input.role,
            invitedBy: ctx.userId,
            expiresAt,
          })
          .returning()
        return row
      })

      if (!invite) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create invitation' })
      }

      // Send invite email — non-blocking
      const APP_URL = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
      const acceptUrl = `${APP_URL}/invite/${token}`

      sendInviteEmail(input.email, caller?.email ?? null, org.name, acceptUrl).catch((err) => {
        console.error('[inviteMember] failed to send invite email:', err)
      })

      return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }
    }),

  /** List pending (not yet accepted, not expired) invites for an org */
  listInvites: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Must be owner or admin
      const [membership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
        .limit(1)

      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only org owners and admins can view invitations' })
      }

      const invites = await db
        .select({
          id: orgInvites.id,
          email: orgInvites.email,
          role: orgInvites.role,
          expiresAt: orgInvites.expiresAt,
          createdAt: orgInvites.createdAt,
        })
        .from(orgInvites)
        .where(
          and(
            eq(orgInvites.orgId, input.orgId),
            isNull(orgInvites.acceptedAt),
            gt(orgInvites.expiresAt, new Date()),
          )
        )
        .orderBy(orgInvites.createdAt)

      return invites
    }),

  /** Revoke a pending invite */
  revokeInvite: protectedProcedure
    .input(z.object({ inviteId: z.string().uuid(), orgId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Must be owner or admin
      const [membership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
        .limit(1)

      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only org owners and admins can revoke invitations' })
      }

      const [deleted] = await db
        .delete(orgInvites)
        .where(and(eq(orgInvites.id, input.inviteId), eq(orgInvites.orgId, input.orgId)))
        .returning({ id: orgInvites.id })

      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' })
      }

      return { id: deleted.id, revoked: true }
    }),

  /** Remove a member from the org */
  removeMember: protectedProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Caller must be owner or admin, and cannot remove themselves if owner
      const [callerMembership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
        .limit(1)

      if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only org owners and admins can remove members' })
      }

      // Cannot remove the org owner
      const [org] = await db
        .select({ ownerId: organizations.ownerId })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
        .limit(1)

      if (org?.ownerId === input.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove the organization owner' })
      }

      const [removed] = await db
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, input.userId)))
        .returning({ id: orgMembers.id })

      if (!removed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this organization' })
      }

      return { id: removed.id, removed: true }
    }),
})
