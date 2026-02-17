import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { redis, RedisKeys } from '@/lib/redis'
import type { CloudToBrowserMessage, CloudToAgentMessage } from '@sessionforge/shared-types'
import { db, sessions, machines } from '@/db'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PING_INTERVAL_MS = 30_000

// Browser message types (browser → cloud)
type BrowserToCloudMessage =
  | { type: 'session_input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'ping' }

// ─── WebSocket handler for Browser Dashboard connections ──────────────────────

export async function GET(req: NextRequest) {
  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 })
  }

  // Authenticate via NextAuth session cookie
  const userSession = await auth()
  if (!userSession?.user?.id) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } }),
      { status: 401 }
    )
  }

  const userId = userSession.user.id

  // STUB: Next.js 14 WebSocket upgrade (requires custom server or next-ws package)
  // @ts-expect-error - experimental WebSocket API
  const { socket: ws, response: upgradeResponse } = await req.socket?.upgrade?.() ?? {}

  if (!ws) {
    return new Response('WebSocket upgrade failed', { status: 500 })
  }

  let pingTimer: ReturnType<typeof setInterval> | null = null
  let redisSubscriber: Awaited<ReturnType<typeof createSubscriber>> | null = null

  // Start Redis pub/sub subscription
  try {
    redisSubscriber = await createSubscriber(userId, ws)
  } catch (err) {
    console.error('[ws/dashboard] failed to create Redis subscriber:', err)
    ws.close(1011, 'Internal error')
    return upgradeResponse
  }

  // Periodic ping to keep browser connection alive
  pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      const pong: CloudToBrowserMessage = { type: 'pong' }
      ws.send(JSON.stringify(pong))
    }
  }, PING_INTERVAL_MS)

  ws.addEventListener('message', async (event: MessageEvent) => {
    let msg: BrowserToCloudMessage

    try {
      msg = JSON.parse(event.data as string) as BrowserToCloudMessage
    } catch {
      console.warn('[ws/dashboard] failed to parse message from browser')
      return
    }

    try {
      await handleBrowserMessage(msg, userId)
    } catch (err) {
      console.error('[ws/dashboard] error handling browser message:', err)
    }
  })

  ws.addEventListener('close', () => {
    if (pingTimer) clearInterval(pingTimer)
    redisSubscriber?.unsubscribe().catch(console.error)
  })

  ws.addEventListener('error', (err: Event) => {
    console.error('[ws/dashboard] WebSocket error:', err)
  })

  return upgradeResponse
}

// ─── Redis Subscriber ─────────────────────────────────────────────────────────

async function createSubscriber(userId: string, ws: WebSocket) {
  // Upstash Redis doesn't support native pub/sub subscribe via REST.
  // STUB: For production, use ioredis with a dedicated connection, or
  // Upstash's subscribe via the @upstash/redis/redis.ts#subscribe method.
  //
  // Pattern for ioredis:
  // const subscriber = new Redis(process.env.REDIS_URL)
  // subscriber.subscribe(RedisKeys.dashboardChannel(userId))
  // subscriber.on('message', (channel, message) => { ws.send(message) })

  const channel = RedisKeys.dashboardChannel(userId)

  // Poll-based fallback for Upstash REST API (not ideal for production at scale)
  // Replace with proper pub/sub when using ioredis
  let running = true

  async function poll() {
    // STUB: Use XREAD on a Redis stream or ioredis subscribe for real-time delivery.
    // This is a polling placeholder for development environments without native pub/sub.
  }

  return {
    unsubscribe: async () => {
      running = false
    },
  }
}

// ─── Browser Message Handler ──────────────────────────────────────────────────

async function handleBrowserMessage(msg: BrowserToCloudMessage, userId: string) {
  switch (msg.type) {
    case 'ping': {
      // Browser pings to keep the connection alive - no action needed
      // (server already sends pong on interval)
      break
    }

    case 'session_input': {
      const { sessionId, data } = msg

      // Verify session belongs to user
      const [record] = await db
        .select({ id: sessions.id, machineId: sessions.machineId, status: sessions.status })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .limit(1)

      if (!record || record.status !== 'running') return

      // Forward input to agent via Redis
      const inputCommand: CloudToAgentMessage = {
        type: 'session_input',
        sessionId,
        data,
      }

      await redis.publish(RedisKeys.agentChannel(record.machineId), JSON.stringify(inputCommand))
      break
    }

    case 'resize': {
      const { sessionId, cols, rows } = msg

      const [record] = await db
        .select({ id: sessions.id, machineId: sessions.machineId, status: sessions.status })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .limit(1)

      if (!record || record.status !== 'running') return

      const resizeCommand: CloudToAgentMessage = {
        type: 'resize',
        sessionId,
        cols,
        rows,
      }

      await redis.publish(RedisKeys.agentChannel(record.machineId), JSON.stringify(resizeCommand))
      break
    }
  }
}
