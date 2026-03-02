// WebSocket for dashboard connections is handled by apps/web/server.js
// (custom Node.js HTTP server with ws.WebSocketServer on the 'upgrade' event).
//
// Next.js App Router cannot handle WebSocket upgrades — this file is a
// placeholder so the route path exists in the routing table.
// Upgrade requests to /api/ws/dashboard are intercepted in server.js BEFORE
// they reach Next.js.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { error: 'Use WebSocket upgrade to connect to /api/ws/dashboard' },
    { status: 426 }
  )
}
