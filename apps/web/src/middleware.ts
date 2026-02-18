import { auth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ─── Rate Limiters ─────────────────────────────────────────────────────────────

const loginRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '15 m'),
  prefix: 'rl:login',
  analytics: false,
})

const magicLinkRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, '1 h'),
  prefix: 'rl:magic',
  analytics: false,
})

const LOGIN_ROUTES = new Set([
  '/api/auth/callback/credentials',
  '/api/auth/register',
])

const MAGIC_LINK_ROUTES = new Set([
  '/api/auth/signin/resend',
  '/api/auth/callback/resend',
])

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/machines',
  '/sessions',
  '/keys',
  '/settings',
  '/onboarding',
]

const AUTH_ROUTES = ['/login', '/signup']

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl

  // ── Rate limiting ──────────────────────────────────────────────────────────
  if (LOGIN_ROUTES.has(pathname)) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? '127.0.0.1'

    const { success, limit, remaining, reset } = await loginRatelimit.limit(ip)
    if (!success) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset': String(reset),
            'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
          },
        }
      )
    }
  }

  if (MAGIC_LINK_ROUTES.has(pathname) && req.method === 'POST') {
    const body = await req.text()
    const email = new URLSearchParams(body).get('email')
      ?? req.nextUrl.searchParams.get('email')

    if (email) {
      const { success, limit, remaining, reset } = await magicLinkRatelimit.limit(`email:${email.toLowerCase()}`)
      if (!success) {
        return NextResponse.json(
          { error: 'Too many magic link requests. Please try again in an hour.' },
          {
            status: 429,
            headers: {
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': String(remaining),
              'X-RateLimit-Reset': String(reset),
              'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
            },
          }
        )
      }
      return NextResponse.next({
        request: new Request(req.url, { method: req.method, headers: req.headers, body }),
      })
    }
  }

  // ── Auth routing ───────────────────────────────────────────────────────────
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route))

  if (!isProtected && !isAuthRoute) return NextResponse.next()

  const session = await auth()

  if (isProtected && !session) {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthRoute && session) {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/auth/callback/credentials',
    '/api/auth/register',
    '/api/auth/signin/resend',
    '/api/auth/callback/resend',
    '/((?!_next/static|_next/image|favicon.ico|api/(?!auth).).*)',
  ],
}
