import { initTRPC, TRPCError } from '@trpc/server'
import type { NextRequest } from 'next/server'
import superjson from 'superjson'
import { ZodError } from 'zod'
import { auth } from '@/lib/auth'
import { validateApiKey } from '@/lib/api-keys'
import { db } from '@/db'

// ─── Context ──────────────────────────────────────────────────────────────────

export interface TRPCContext {
  db: typeof db
  userId: string | null
  apiKeyUserId: string | null
  apiKeyScopes: string[]
  req: NextRequest
}

export async function createTRPCContext({ req }: { req: NextRequest }): Promise<TRPCContext> {
  // Check for NextAuth session
  const session = await auth()
  const userId = session?.user?.id ?? null

  // Check for API key in Authorization header: "Bearer sf_live_..."
  let apiKeyUserId: string | null = null
  let apiKeyScopes: string[] = []

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer sf_live_')) {
    const key = authHeader.replace('Bearer ', '')
    const validKey = await validateApiKey(key)
    if (validKey) {
      apiKeyUserId = validKey.userId
      apiKeyScopes = validKey.scopes
    }
  }

  return {
    db,
    userId,
    apiKeyUserId,
    apiKeyScopes,
    req,
  }
}

// ─── tRPC Init ────────────────────────────────────────────────────────────────

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

// ─── Router & Procedure Builders ──────────────────────────────────────────────

export const router = t.router
export const publicProcedure = t.procedure
export const middleware = t.middleware

// Middleware: require NextAuth session
const isAuthenticated = middleware(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    })
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId, // narrowed to string
    },
  })
})

// Middleware: accept either NextAuth session or valid API key
const isAuthenticatedOrApiKey = middleware(async ({ ctx, next }) => {
  const effectiveUserId = ctx.userId ?? ctx.apiKeyUserId

  if (!effectiveUserId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required: provide a session or API key',
    })
  }

  return next({
    ctx: {
      ...ctx,
      userId: effectiveUserId,
    },
  })
})

/** Requires a logged-in NextAuth session */
export const protectedProcedure = publicProcedure.use(isAuthenticated)

/** Accepts either a NextAuth session or a valid sf_live_ API key */
export const apiKeyProcedure = publicProcedure.use(isAuthenticatedOrApiKey)
