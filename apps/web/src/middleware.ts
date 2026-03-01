import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { Redis } from '@upstash/redis'
import { isIpInCidr } from '@/lib/ip-cidr-utils'

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

// Routes that must remain accessible without authentication
const PUBLIC_PREFIXES = ['/invite']

// Paths exempt from IP allowlist enforcement
const IP_ALLOWLIST_EXEMPT_PREFIXES = [
  '/api/health',
  '/api/webhooks/stripe',
  '/api/auth',
  '/invite',
  '/login',
  '/signup',
]

// ─── Upstash Redis (Edge-compatible) ────────────────────────────────────────

function getEdgeRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

// ─── IP Allowlist check using cached CIDRs from Redis ───────────────────────

async function checkIpAllowlistFromCache(orgId: string, ip: string): Promise<boolean> {
  try {
    const edgeRedis = getEdgeRedis()
    if (!edgeRedis) return true // If Redis not configured, allow all

    const cacheKey = `ip-allowlist:${orgId}`
    const cached = await edgeRedis.get<string>(cacheKey)
    if (cached === null) return true // No cache entry → allow (DB not accessible in Edge)

    const cidrs = JSON.parse(cached) as string[]
    if (cidrs.length === 0) return true
    return cidrs.some((cidr) => isIpInCidr(ip, cidr))
  } catch {
    // Never block on allowlist check failure
    return true
  }
}

// ─── Middleware ─────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route))
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))

  if (!isProtected && !isAuthRoute) return NextResponse.next()
  if (isPublic) return NextResponse.next()

  // Use getToken which reads the JWT directly — no NextAuth handler needed
  // secureCookie must match what NextAuth used when setting the cookie:
  //   HTTPS → __Secure-authjs.session-token (salt = cookie name)
  //   HTTP  → authjs.session-token
  // Getting this wrong causes silent decryption failure (wrong salt) → null token
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')
  const secureCookie = proto === 'https'
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? '',
    secureCookie,
  })

  // Build base URL from forwarded headers (Cloud Run sets these correctly)
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

  // ── First-login onboarding redirect ───────────────────────────────────────
  // Authenticated users who haven't completed onboarding are sent to /onboarding
  // Exclude /onboarding itself to avoid redirect loop
  if (pathname.startsWith('/dashboard') && token && !token.onboardingCompletedAt) {
    return NextResponse.redirect(new URL('/onboarding', baseUrl))
  }

  // ── IP Allowlist enforcement ───────────────────────────────────────────────
  // Only enforce for authenticated users with an org (token.orgId is set by NextAuth callback)
  // Exempt certain paths from IP checking
  const isIpExempt = IP_ALLOWLIST_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  if (!isIpExempt && token?.sub && token?.orgId) {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      '127.0.0.1'

    const allowed = await checkIpAllowlistFromCache(token.orgId as string, ip)
    if (!allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'IP_BLOCKED',
            message: 'Your IP address is not in the allowlist',
            statusCode: 403,
          },
        },
        { status: 403 }
      )
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|icons/|images/|api/).*)',
  ],
}
