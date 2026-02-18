import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that require authentication
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/machines',
  '/sessions',
  '/keys',
  '/settings',
  '/onboarding',
]

// Routes that authenticated users should be redirected away from
const AUTH_ROUTES = ['/login', '/signup']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route))

  if (!isProtected && !isAuthRoute) {
    return NextResponse.next()
  }

  const session = await auth()

  // Unauthenticated → redirect to login
  if (isProtected && !session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Already authenticated → redirect away from login/signup
  if (isAuthRoute && session) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files
     * - API routes (handled separately)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
}
