import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, machines, sessions } from '@/db'
import { validateApiKey } from '@/lib/api-keys'
import { redis, RedisKeys, SESSION_LOG_MAX_LINES, SESSION_LOG_TTL_SECONDS } from '@/lib/redis'
import type { AgentMessage, CloudToAgentMessage, CloudToBrowserMessage } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEARTBEAT_INTERVAL_MS = 30_000
const AGENT_TIMEOUT_MS = 90_000 // mark offline after 3 missed heartbeats

// ─── WebSocket handler for Agent connections ───────────────────────────────────

export async function GET(req: NextRequest) {
  const { socket, response } = (req as unknown as { socket: WebSocket; response: Response })

  // Next.js 14 WebSocket upgrade via the experimental server WebSocket API
  // STUB: This requires Next.js custom server or edge runtime with WebSocket support.
  // In production, use a separate WebSocket server (e.g. ws package on Node.js custom server)
  // or deploy via a platform that supports WebSocket routes (Railway, Fly.io, Render).

  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 })
  }

  // Validate API key from query param
  const url = new URL(req.url)
  const apiKey = url.searchParams.get('key')

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'API key required', statusCode: 401 } }),
      { status: 401 }
    )
  }

  const validKey = await validateApiKey(apiKey)
  if (!validKey) {
    return new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired API key', statusCode: 401 } }),
      { status: 401 }
    )
  }

  // @ts-expect-error - Next.js experimental WebSocket API not in types
  const { socket: ws, response: upgradeResponse } = (typeof Deno !== 'undefined')
    ? // Deno runtime (Edge)
      await (req as unknown as { socket: { upgrade: () => Promise<{ socket: WebSocket; response: Response }> } }).socket?.upgrade?.()
    : // Node.js runtime via next-ws or custom server
      { socket: (req as unknown as { socket: WebSocket }).socket, response }

  let machineId: string | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let lastHeartbeatAt = Date.now()

  // Agent timeout watchdog
  const timeoutWatchdog = setInterval(async () => {
    if (Date.now() - lastHeartbeatAt > AGENT_TIMEOUT_MS && machineId) {
      await markMachineOffline(machineId)
    }
  }, HEARTBEAT_INTERVAL_MS)

  // Ping keepalive from server to agent
  heartbeatTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      const ping: CloudToAgentMessage = { type: 'ping' }
      ws.send(JSON.stringify(ping))
    }
  }, HEARTBEAT_INTERVAL_MS)

  ws.addEventListener('message', async (event: MessageEvent) => {
    let msg: AgentMessage

    try {
      msg = JSON.parse(event.data as string) as AgentMessage
    } catch {
      console.warn('[ws/agent] failed to parse message:', event.data)
      return
    }

    try {
      await handleAgentMessage(msg, ws, validKey.userId, (id) => {
        machineId = id
        lastHeartbeatAt = Date.now()
      })

      if (msg.type === 'heartbeat') {
        lastHeartbeatAt = Date.now()
      }
    } catch (err) {
      console.error('[ws/agent] error handling message:', msg.type, err)
    }
  })

  ws.addEventListener('close', async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    clearInterval(timeoutWatchdog)

    if (machineId) {
      await markMachineOffline(machineId)
    }
  })

  ws.addEventListener('error', (err: Event) => {
    console.error('[ws/agent] WebSocket error:', err)
  })

  return upgradeResponse
}

// ─── Message Handler ──────────────────────────────────────────────────────────

async function handleAgentMessage(
  msg: AgentMessage,
  ws: WebSocket,
  userId: string,
  onMachineId: (id: string) => void
) {
  switch (msg.type) {
    case 'register': {
      const { machineId, name, os, hostname, version } = msg

      // Validate os is a valid enum value
      const validOs = ['windows', 'macos', 'linux']
      if (!validOs.includes(os)) {
        console.warn('[ws/agent] invalid OS value:', os)
        return
      }

      // Upsert machine record
      const [upserted] = await db
        .insert(machines)
        .values({
          id: machineId,
          userId,
          name,
          os: os as 'windows' | 'macos' | 'linux',
          hostname,
          agentVersion: version,
          status: 'online',
          lastSeen: new Date(),
        })
        .onConflictDoUpdate({
          target: machines.id,
          set: {
            name,
            hostname,
            agentVersion: version,
            status: 'online',
            lastSeen: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning({ id: machines.id })

      if (upserted) {
        onMachineId(upserted.id)

        // Broadcast machine_updated to dashboard
        await publishDashboardUpdate(userId, {
          type: 'machine_updated',
          machine: { id: upserted.id, status: 'online', cpu: 0, memory: 0 },
        })
      }
      break
    }

    case 'heartbeat': {
      const { machineId, cpu, memory } = msg

      // Update lastSeen and cache metrics in Redis
      await Promise.all([
        db
          .update(machines)
          .set({ lastSeen: new Date(), status: 'online', updatedAt: new Date() })
          .where(eq(machines.id, machineId)),
        redis.setex(
          RedisKeys.machineMetrics(machineId),
          120, // TTL: 2 minutes
          JSON.stringify({ cpu, memory, disk: msg.disk, sessionCount: msg.sessionCount, ts: Date.now() })
        ),
      ])

      // Broadcast live metrics to dashboard
      await publishDashboardUpdate(userId, {
        type: 'machine_updated',
        machine: { id: machineId, status: 'online', cpu, memory },
      })
      break
    }

    case 'session_started': {
      const { session } = msg

      await db
        .update(sessions)
        .set({
          pid: session.pid,
          processName: session.processName,
          workdir: session.workdir,
          status: 'running',
          startedAt: new Date(session.startedAt),
        })
        .where(eq(sessions.id, session.id))

      // Look up machine to get userId for dashboard update
      const [sessionRecord] = await db
        .select({ machineId: sessions.machineId })
        .from(sessions)
        .where(eq(sessions.id, session.id))
        .limit(1)

      if (sessionRecord) {
        await publishDashboardUpdate(userId, {
          type: 'session_updated',
          session: { id: session.id, status: 'running', machineId: sessionRecord.machineId },
        })
      }
      break
    }

    case 'session_stopped': {
      const { sessionId, exitCode } = msg

      await db
        .update(sessions)
        .set({ status: 'stopped', exitCode, stoppedAt: new Date() })
        .where(eq(sessions.id, sessionId))

      const [sessionRecord] = await db
        .select({ machineId: sessions.machineId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)

      if (sessionRecord) {
        await publishDashboardUpdate(userId, {
          type: 'session_updated',
          session: { id: sessionId, status: 'stopped', machineId: sessionRecord.machineId },
        })
      }
      break
    }

    case 'session_crashed': {
      const { sessionId, error } = msg

      await db
        .update(sessions)
        .set({ status: 'crashed', stoppedAt: new Date() })
        .where(eq(sessions.id, sessionId))

      const [sessionRecord] = await db
        .select({ machineId: sessions.machineId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1)

      if (sessionRecord) {
        await publishDashboardUpdate(userId, {
          type: 'session_updated',
          session: { id: sessionId, status: 'crashed', machineId: sessionRecord.machineId },
        })

        await publishDashboardUpdate(userId, {
          type: 'alert_fired',
          alertId: crypto.randomUUID(),
          message: `Session ${sessionId} crashed: ${error}`,
          severity: 'warning',
        })
      }
      break
    }

    case 'session_output': {
      const { sessionId, data } = msg

      // Append to Redis log ring buffer
      const logKey = RedisKeys.sessionLogs(sessionId)
      await redis.rpush(logKey, data)

      // Trim buffer to max lines
      await redis.ltrim(logKey, -SESSION_LOG_MAX_LINES, -1)

      // Set/refresh TTL
      await redis.expire(logKey, SESSION_LOG_TTL_SECONDS)

      // Forward to subscribed dashboard browser connections
      await publishDashboardUpdate(userId, {
        type: 'session_output',
        sessionId,
        data,
      })
      break
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function markMachineOffline(machineId: string) {
  try {
    await db
      .update(machines)
      .set({ status: 'offline', updatedAt: new Date() })
      .where(eq(machines.id, machineId))
  } catch (err) {
    console.error('[ws/agent] failed to mark machine offline:', err)
  }
}

async function publishDashboardUpdate(userId: string, message: CloudToBrowserMessage) {
  try {
    await redis.publish(RedisKeys.dashboardChannel(userId), JSON.stringify(message))
  } catch (err) {
    console.error('[ws/agent] failed to publish dashboard update:', err)
  }
}
