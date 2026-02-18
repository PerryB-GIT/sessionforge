import NextAuth from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authConfig } from '@/lib/auth.config'

// Edge-safe auth instance using the lightweight config (no bcrypt, no DB)
const { auth } = NextAuth(authConfig)

// ─── Route Sets ────────────────────────────────────────────────────────────

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/machines',
  '/sessions',
  '/keys',
  '/settings',
  '/onboarding',
]

const AUTH_ROUTES = ['/login', '/signup']

// ─── Middleware ─────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route))

  if (!isProtected && !isAuthRoute) return NextResponse.next()

  const session = await auth()

  // Build base URL from forwarded headers (Cloud Run sets these correctly)
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'sessionforge.dev'
  const baseUrl = `${proto}://${host}`

  if (isProtected && !session?.user?.id) {
    const loginUrl = new URL('/login', baseUrl)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthRoute && session?.user?.id) {
    return NextResponse.redirect(new URL('/dashboard', baseUrl))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
}
