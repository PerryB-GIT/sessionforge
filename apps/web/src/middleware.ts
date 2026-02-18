import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

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

  // Use getToken which reads the JWT directly — no NextAuth handler needed
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? '',
    cookieName:
      process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
  })

  // Build base URL from forwarded headers (Cloud Run sets these correctly)
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'sessionforge.dev'
  const baseUrl = `${proto}://${host}`

  if (isProtected && !token?.sub) {
    const loginUrl = new URL('/login', baseUrl)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthRoute && token?.sub) {
    return NextResponse.redirect(new URL('/dashboard', baseUrl))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|icons/|images/|api/).*)',
  ],
}
