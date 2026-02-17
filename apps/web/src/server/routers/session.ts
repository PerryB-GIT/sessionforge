import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { eq, and, desc, count } from 'drizzle-orm'
import { router, protectedProcedure, apiKeyProcedure } from '../trpc'
import { db, sessions, machines } from '@/db'
import { redis, RedisKeys, SESSION_LOG_MAX_LINES } from '@/lib/redis'
import { checkSessionLimit, PlanLimitError } from '@/lib/plan-enforcement'
import type { CloudToAgentMessage } from '@sessionforge/shared-types'

export const sessionRouter = router({
  /** List sessions with optional filtering */
  list: apiKeyProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        machineId: z.string().uuid().optional(),
        status: z.enum(['running', 'stopped', 'crashed', 'paused']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, machineId, status } = input
      const offset = (page - 1) * pageSize

      const whereConditions = [eq(sessions.userId, ctx.userId)]
      if (machineId) whereConditions.push(eq(sessions.machineId, machineId))
      if (status) whereConditions.push(eq(sessions.status, status))
      const whereClause = whereConditions.length === 1 ? whereConditions[0] : and(...whereConditions)

      const [totalResult, rows] = await Promise.all([
        db.select({ count: count() }).from(sessions).where(whereClause),
        db
          .select()
          .from(sessions)
          .where(whereClause)
          .orderBy(desc(sessions.createdAt))
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

  /** Get a single session by ID */
  get: apiKeyProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [record] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, input.id), eq(sessions.userId, ctx.userId)))
        .limit(1)

      if (!record) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
      }

      return record
    }),

  /** Start a new session on a machine */
  start: apiKeyProcedure
    .input(
      z.object({
        machineId: z.string().uuid(),
        command: z.string().default('claude'),
        workdir: z.string().optional(),
        env: z.record(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { machineId, command, workdir, env } = input

      // Verify machine ownership and online status
      const [machine] = await db
        .select({ id: machines.id, status: machines.status })
        .from(machines)
        .where(and(eq(machines.id, machineId), eq(machines.userId, ctx.userId)))
        .limit(1)

      if (!machine) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Machine not found' })
      }

      if (machine.status !== 'online') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Machine is ${machine.status}. It must be online to start a session.`,
        })
      }

      // Check plan limits
      try {
        await checkSessionLimit(ctx.userId)
      } catch (err) {
        if (err instanceof PlanLimitError) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: err.message,
            cause: err,
          })
        }
        throw err
      }

      const requestId = crypto.randomUUID()

      const [newSession] = await db
        .insert(sessions)
        .values({
          machineId,
          userId: ctx.userId,
          processName: command,
          workdir: workdir ?? null,
          status: 'running',
        })
        .returning()

      if (!newSession) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create session' })
      }

      // Send start command to agent via Redis
      const startCommand: CloudToAgentMessage = {
        type: 'start_session',
        requestId,
        command,
        workdir: workdir ?? '/home',
        env,
      }

      await redis.publish(RedisKeys.agentChannel(machineId), JSON.stringify(startCommand))

      return newSession
    }),

  /** Stop a running session */
  stop: apiKeyProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        force: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [record] = await db
        .select({ id: sessions.id, machineId: sessions.machineId, status: sessions.status })
        .from(sessions)
        .where(and(eq(sessions.id, input.id), eq(sessions.userId, ctx.userId)))
        .limit(1)

      if (!record) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
      }

      if (record.status !== 'running' && record.status !== 'paused') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Session is already ${record.status}`,
        })
      }

      const stopCommand: CloudToAgentMessage = {
        type: 'stop_session',
        sessionId: record.id,
        force: input.force,
      }

      await redis.publish(RedisKeys.agentChannel(record.machineId), JSON.stringify(stopCommand))

      await db
        .update(sessions)
        .set({ status: 'stopped', stoppedAt: new Date() })
        .where(eq(sessions.id, record.id))

      return { id: record.id, stopped: true }
    }),

  /** Retrieve session PTY logs from Redis buffer */
  logs: apiKeyProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        limit: z.number().int().min(1).max(SESSION_LOG_MAX_LINES).default(500),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const [record] = await db
        .select({ id: sessions.id, status: sessions.status })
        .from(sessions)
        .where(and(eq(sessions.id, input.id), eq(sessions.userId, ctx.userId)))
        .limit(1)

      if (!record) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
      }

      const logKey = RedisKeys.sessionLogs(input.id)
      const [lines, total] = await Promise.all([
        redis.lrange(logKey, input.offset, input.offset + input.limit - 1),
        redis.llen(logKey),
      ])

      return {
        sessionId: input.id,
        lines: lines as string[],
        total,
        source: 'redis' as const,
      }
    }),
})
