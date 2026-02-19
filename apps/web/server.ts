/**
 * Custom Node.js HTTP server for SessionForge
 *
 * Wraps Next.js with a real http.Server so that WebSocket upgrades can be
 * intercepted before they reach Next.js (which cannot handle WS upgrades in
 * App Router). All non-upgrade requests are forwarded to Next.js unchanged.
 *
 * WebSocket path: /api/ws/agent?key=sf_live_xxx
 */

import http from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'
import { eq } from 'drizzle-orm'

// Use relative paths — path aliases (@/*) don't work outside Next.js bundler
import { db, machines, sessions } from './src/db/index'
import { validateApiKey } from './src/lib/api-keys'
import { redis, RedisKeys, SESSION_LOG_MAX_LINES, SESSION_LOG_TTL_SECONDS } from './src/lib/redis'
import type { AgentMessage, CloudToAgentMessage, CloudToBrowserMessage } from '../../packages/shared-types/src/index'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const dev = process.env.NODE_ENV !== 'production'

const HEARTBEAT_INTERVAL_MS = 30_000
const AGENT_TIMEOUT_MS = 90_000

// ─── Boot Next.js ─────────────────────────────────────────────────────────────

const app = next({ dev, hostname: '0.0.0.0', port: PORT })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  // ─── HTTP Server ────────────────────────────────────────────────────────────

  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true)
    handle(req, res, parsedUrl)
  })

  // ─── WebSocket Server (noServer — we handle upgrade manually) ────────────────

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', async (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? '/', true)

    // Only handle agent WebSocket path
    if (pathname !== '/api/ws/agent') {
      socket.destroy()
      return
    }

    const apiKey = Array.isArray(query.key) ? query.key[0] : query.key

    if (!apiKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    // Validate API key against DB before upgrading
    let validKey: Awaited<ReturnType<typeof validateApiKey>>
    try {
      validKey = await validateApiKey(apiKey)
    } catch (err) {
      console.error('[ws/agent] DB error during auth:', err)
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
      return
    }

    if (!validKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, validKey)
    })
  })

  // ─── WebSocket Connection Handler ────────────────────────────────────────────

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, validKey: NonNullable<Awaited<ReturnType<typeof validateApiKey>>>) => {
    let machineId: string | null = null
    let lastHeartbeatAt = Date.now()

    // Watchdog: mark machine offline after 3 missed heartbeats
    const timeoutWatchdog = setInterval(async () => {
      if (Date.now() - lastHeartbeatAt > AGENT_TIMEOUT_MS && machineId) {
        await markMachineOffline(machineId)
      }
    }, HEARTBEAT_INTERVAL_MS)

    // Server → agent keepalive ping
    const pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const ping: CloudToAgentMessage = { type: 'ping' }
        ws.send(JSON.stringify(ping))
      }
    }, HEARTBEAT_INTERVAL_MS)

    ws.on('message', async (data) => {
      let msg: AgentMessage
      try {
        msg = JSON.parse(data.toString()) as AgentMessage
      } catch {
        console.warn('[ws/agent] failed to parse message')
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
        console.error('[ws/agent] error handling message:', (msg as AgentMessage).type, err)
      }
    })

    ws.on('close', async () => {
      clearInterval(pingTimer)
      clearInterval(timeoutWatchdog)
      if (machineId) {
        await markMachineOffline(machineId)
      }
    })

    ws.on('error', (err) => {
      console.error('[ws/agent] WebSocket error:', err.message)
    })
  })

  // ─── Start listening ─────────────────────────────────────────────────────────

  server.listen(PORT, () => {
    console.log(`> SessionForge ready on http://0.0.0.0:${PORT} [${dev ? 'dev' : 'prod'}]`)
  })
})

// ─── Agent Message Handler ───────────────────────────────────────────────────

async function handleAgentMessage(
  msg: AgentMessage,
  ws: WebSocket,
  userId: string,
  onMachineId: (id: string) => void,
) {
  switch (msg.type) {
    case 'register': {
      const { machineId, name, os, hostname, version } = msg

      const validOs = ['windows', 'macos', 'linux']
      if (!validOs.includes(os)) {
        console.warn('[ws/agent] invalid OS value:', os)
        return
      }

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
        await publishDashboardUpdate(userId, {
          type: 'machine_updated',
          machine: { id: upserted.id, status: 'online', cpu: 0, memory: 0 },
        })
      }
      break
    }

    case 'heartbeat': {
      const { machineId, cpu, memory } = msg

      await Promise.all([
        db
          .update(machines)
          .set({ lastSeen: new Date(), status: 'online', updatedAt: new Date() })
          .where(eq(machines.id, machineId)),
        redis.setex(
          RedisKeys.machineMetrics(machineId),
          120,
          JSON.stringify({ cpu, memory, disk: msg.disk, sessionCount: msg.sessionCount, ts: Date.now() }),
        ),
      ])

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

      const logKey = RedisKeys.sessionLogs(sessionId)
      await redis.rpush(logKey, data)
      await redis.ltrim(logKey, -SESSION_LOG_MAX_LINES, -1)
      await redis.expire(logKey, SESSION_LOG_TTL_SECONDS)

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
