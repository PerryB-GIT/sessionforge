import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe auth config — no Node.js-only modules (bcrypt, drizzle, etc.)
 * Used by middleware.ts which runs in the Edge Runtime.
 *
 * The full auth config (with Credentials provider + DB callbacks) lives in
 * auth.ts and is used only in the Node.js API route handler.
 */
export const authConfig: NextAuthConfig = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
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

  providers: [],

  callbacks: {
    authorized({ auth }) {
      // Used only for session check in middleware — not sign-in logic
      return !!auth?.user?.id
    },
  },
}
