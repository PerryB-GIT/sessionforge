import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain')
  if (!domain) return NextResponse.json({ data: null, error: null })

  // TODO: To properly scope SSO by domain, add an `emailDomain` column to `sso_configs`
  // or `organizations`, then filter: WHERE emailDomain = domain AND enabled = true.
  // Currently disabled to prevent cross-tenant SSO redirect — the previous implementation
  // queried for any globally-enabled SSO config without scoping by org/domain, which would
  // redirect a user from tenant A into tenant B's IdP.
  // See: feat/enterprise-gaps E7
  return NextResponse.json({ data: null, error: null })
}
