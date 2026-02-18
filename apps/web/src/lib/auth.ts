import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import Resend from 'next-auth/providers/resend'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, users } from '@/db'
import { z } from 'zod'

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

  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-next-auth.session-token'
          : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/verify-email?magic=1',
  },

  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials) {
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

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          plan: user.plan,
        }
      },
    }),

    Google({
      // STUB: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),

    GitHub({
      // STUB: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in environment
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),

    Resend({
      apiKey: process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM ?? 'noreply@sessionforge.dev',
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false

      // For OAuth providers, auto-create user if they don't exist
      if (account && account.provider !== 'credentials') {
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
      }

      return true
    },

    async jwt({ token, user, trigger, session }) {
      if (user) {
        // Initial sign in: enrich token from DB
        const [dbUser] = await db
          .select({ id: users.id, plan: users.plan, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.email, user.email!.toLowerCase()))
          .limit(1)

        if (dbUser) {
          token.sub = dbUser.id
          token.plan = dbUser.plan
          token.email = dbUser.email
          token.name = dbUser.name
        }
      }

      // Handle session update trigger (e.g. plan upgrade)
      if (trigger === 'update' && session?.plan) {
        token.plan = session.plan
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

// Named export for use in tRPC context and middleware
export const authOptions = authConfig
