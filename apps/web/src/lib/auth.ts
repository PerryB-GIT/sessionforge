import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, users, orgMembers } from '@/db'
import { z } from 'zod'

// ─── Sign-in Rate Limiter ──────────────────────────────────────────────────────
// 10 attempts per IP per 15-minute sliding window.
// Called from the Credentials authorize() function.
// Gracefully no-ops if Redis env vars are absent (dev environments).
async function checkLoginRateLimit(ip: string): Promise<boolean> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!redisUrl || !redisToken) return true // no Redis → allow

  try {
    const { Ratelimit } = await import('@upstash/ratelimit')
    const { Redis } = await import('@upstash/redis')
    const ratelimit = new Ratelimit({
      redis: new Redis({ url: redisUrl, token: redisToken }),
      limiter: Ratelimit.slidingWindow(10, '15 m'),
      prefix: 'rl:login',
    })
    const { success } = await ratelimit.limit(ip)
    return success
  } catch {
    // Redis unavailable → fail open (do not lock out users)
    return true
  }
}

// ─── Credential Validation Schema ─────────────────────────────────────────────

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

// ─── Auth Config ──────────────────────────────────────────────────────────────

export const authConfig: NextAuthConfig = {
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  trustHost: true,

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials, request) {
        // Rate limit by IP: 10 attempts per 15-minute window
        const ip =
          (request as Request | undefined)?.headers
            ?.get('x-forwarded-for')
            ?.split(',')[0]
            ?.trim() ??
          (request as Request | undefined)?.headers?.get('x-real-ip') ??
          'unknown'
        const allowed = await checkLoginRateLimit(ip)
        if (!allowed) {
          // authorize() cannot return a 429 — returning null triggers the generic
          // CredentialsSignin error. The rate limit is enforced server-side;
          // the client sees the same "Invalid credentials" message (no enumeration).
          return null
        }

        const parsed = credentialsSchema.safeParse(rawCredentials)
        if (!parsed.success) return null

        const { email, password } = parsed.data

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1)

        if (!user || !user.passwordHash) return null

        const passwordMatch = await bcrypt.compare(password, user.passwordHash)
        if (!passwordMatch) return null

        // Block unverified credentials users
        if (!user.emailVerified) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          plan: user.plan,
          emailVerified: user.emailVerified,
        }
      },
    }),

    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'read:user user:email',
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      // For OAuth providers, resolve email — GitHub may return null even with
      // user:email scope when the account has no verified email address.
      // Fall back to a deterministic placeholder so the account can still be
      // created; the user can add a real email later from their profile.
      if (account && account.provider !== 'credentials') {
        if (!user.email) {
          if (account.provider === 'github' && account.providerAccountId) {
            user.email = `github_${account.providerAccountId}@sessionforge.dev`
          } else {
            // Unknown OAuth provider with no email — block sign-in.
            return false
          }
        }

        const [existing] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, user.email.toLowerCase()))
          .limit(1)

        if (!existing) {
          await db.insert(users).values({
            email: user.email.toLowerCase(),
            name: user.name ?? null,
            emailVerified: new Date(),
          })
        }

        return true
      }

      // Credentials provider: email must be present (authorize() already
      // validates this, but guard here for safety).
      if (!user.email) return false

      return true
    },

    async jwt({ token, user, trigger, session }) {
      if (user) {
        // Initial sign in: enrich token from DB
        const [dbUser] = await db
          .select({
            id: users.id,
            plan: users.plan,
            email: users.email,
            name: users.name,
            emailVerified: users.emailVerified,
            onboardingCompletedAt: users.onboardingCompletedAt,
          })
          .from(users)
          .where(eq(users.email, user.email!.toLowerCase()))
          .limit(1)

        if (dbUser) {
          token.sub = dbUser.id
          token.plan = dbUser.plan
          token.email = dbUser.email
          token.name = dbUser.name
          token.emailVerified = dbUser.emailVerified?.toISOString() ?? null
          token.onboardingCompletedAt = dbUser.onboardingCompletedAt?.toISOString() ?? null

          // Attach orgId so middleware can enforce IP allowlist without a DB call
          const [membership] = await db
            .select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userId, dbUser.id))
            .limit(1)
          if (membership) token.orgId = membership.orgId
        }
      }

      // Handle session update trigger (e.g. plan upgrade, onboarding completion)
      if (trigger === 'update') {
        if (session?.plan) token.plan = session.plan
        if (session?.onboardingCompletedAt)
          token.onboardingCompletedAt = session.onboardingCompletedAt
      }

      return token
    },

    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      if (token.plan) {
        // Attach plan to session for client-side access
        ;(session.user as typeof session.user & { plan: string }).plan = token.plan as string
      }
      return session
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
