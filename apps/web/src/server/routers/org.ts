import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq, and } from 'drizzle-orm'
import { router, protectedProcedure } from '../trpc'
import { db, organizations, orgMembers, users } from '@/db'
import { requireFeature, FeatureNotAvailableError } from '@/lib/plan-enforcement'

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

  /** Invite a member to the org */
  inviteMember: protectedProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        email: z.string().email(),
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

      // Find invitee user
      const [invitee] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1)

      if (!invitee) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No user found with that email address. They must create an account first.',
        })
      }

      // Check if already a member
      const [existingMember] = await db
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, invitee.id)))
        .limit(1)

      if (existingMember) {
        throw new TRPCError({ code: 'CONFLICT', message: 'User is already a member of this organization' })
      }

      const [newMember] = await db
        .insert(orgMembers)
        .values({
          orgId: input.orgId,
          userId: invitee.id,
          role: input.role,
        })
        .returning()

      // STUB: Send invitation email via Resend
      // await resend.emails.send({ ... })

      return { ...newMember, email: input.email }
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
