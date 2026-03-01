import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, ssoConfigs } from '@/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain')
  if (!domain) return NextResponse.json({ data: null, error: null })

  // Find an enabled SSO config
  const [config] = await db
    .select({ provider: ssoConfigs.provider, orgId: ssoConfigs.orgId })
    .from(ssoConfigs)
    .where(eq(ssoConfigs.enabled, true))
    .limit(1)

  if (!config) return NextResponse.json({ data: null, error: null })

  const redirectUrl =
    config.provider === 'saml'
      ? `/api/auth/saml/initiate/${config.orgId}`
      : `/api/auth/signin/oidc-${config.orgId}`

  return NextResponse.json({ data: { redirectUrl }, error: null })
}
