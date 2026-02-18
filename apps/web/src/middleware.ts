import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ─── Rate Limiters ─────────────────────────────────────────────────────────────

// 5 login/register attempts per IP per 15 minutes
const loginRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '15 m'),
  prefix: 'rl:login',
  analytics: false,
})

// 3 magic link requests per email per hour
const magicLinkRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(3, '1 h'),
  prefix: 'rl:magic',
  analytics: false,
})

// ─── Routes that need rate limiting ───────────────────────────────────────────

const LOGIN_ROUTES = new Set([
  '/api/auth/callback/credentials',
  '/api/auth/register',
])

const MAGIC_LINK_ROUTES = new Set([
  '/api/auth/signin/resend',
  '/api/auth/callback/resend',
])

// ─── Middleware ────────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl

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
      const key = `email:${email.toLowerCase()}`
      const { success, limit, remaining, reset } = await magicLinkRatelimit.limit(key)

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

      // Reconstruct request with body since we consumed it
      return NextResponse.next({
        request: new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body,
        }),
      })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/auth/callback/credentials',
    '/api/auth/register',
    '/api/auth/signin/resend',
    '/api/auth/callback/resend',
  ],
}
