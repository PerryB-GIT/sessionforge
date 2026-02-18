export const dynamic = 'force-dynamic'

import { handlers } from '@/lib/auth'
import { NextRequest } from 'next/server'

const wrappedGET = async (req: NextRequest, ctx: { params: { nextauth: string[] } }) => {
  try {
    return await handlers.GET(req, ctx)
  } catch (err) {
    console.error('[nextauth] GET error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
}

const wrappedPOST = async (req: NextRequest, ctx: { params: { nextauth: string[] } }) => {
  try {
    return await handlers.POST(req, ctx)
  } catch (err) {
    console.error('[nextauth] POST error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
}

export { wrappedGET as GET, wrappedPOST as POST }
