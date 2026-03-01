import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq, and, desc, count } from 'drizzle-orm'
import { router, protectedProcedure, apiKeyProcedure } from '../trpc'
import { db, machines } from '@/db'

export const machineRouter = router({
  /** List all machines for the authenticated user with pagination */
  list: apiKeyProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        orgId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, orgId } = input
      const offset = (page - 1) * pageSize

      const whereConditions = [eq(machines.userId, ctx.userId)]
      if (orgId) whereConditions.push(eq(machines.orgId, orgId))
      const whereClause = whereConditions.length === 1 ? whereConditions[0] : and(...whereConditions)

      const [totalResult, rows] = await Promise.all([
        db.select({ count: count() }).from(machines).where(whereClause),
        db
          .select()
          .from(machines)
          .where(whereClause)
          .orderBy(desc(machines.createdAt))
          .limit(pageSize)
          .offset(offset),
      ])

      const total = totalResult[0]?.count ?? 0

      return {
        items: rows,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      }
    }),

  /** Get a single machine by ID */
  get: apiKeyProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [machine] = await db
        .select()
        .from(machines)
        .where(and(eq(machines.id, input.id), eq(machines.userId, ctx.userId)))
        .limit(1)

      if (!machine) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Machine not found' })
      }

      return machine
    }),

  /** Update machine name */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(machines)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(machines.id, input.id), eq(machines.userId, ctx.userId)))
        .returning()

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Machine not found' })
      }

      return updated
    }),

  /** Deregister (delete) a machine */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await db
        .delete(machines)
        .where(and(eq(machines.id, input.id), eq(machines.userId, ctx.userId)))
        .returning({ id: machines.id })

      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Machine not found' })
      }

      return { id: deleted.id, deregistered: true }
    }),
})
