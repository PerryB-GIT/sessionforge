/**
 * Custom Node.js server for SessionForge.
 * Handles WebSocket upgrades for /api/ws/dashboard and /api/ws/agent,
 * then proxies all other requests to the Next.js standalone server.
 *
 * Required because Next.js App Router cannot handle WebSocket upgrades natively.
 *
 * Architecture:
 *   - Next.js runs internally on INTERNAL_PORT (PORT + 1)
 *   - This server listens on PORT (3000) and:
 *       - Intercepts WS upgrades for /api/ws/* (handles them directly)
 *       - Proxies all HTTP requests to Next.js internal port
 */

'use strict'

const http = require('http')
const { parse } = require('url')
const net = require('net')
const path = require('path')
const zlib = require('zlib')
const { promisify } = require('util')
const { WebSocketServer } = require('ws')
const { Redis } = require('@upstash/redis')
const { createHash } = require('crypto')
const postgres = require('postgres')

const gzip = promisify(zlib.gzip)

// ─── Next.js standalone ───────────────────────────────────────────────────────

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const PORT = Number(process.env.PORT ?? 3000)
const INTERNAL_PORT = PORT + 1
const hostname = process.env.HOSTNAME ?? '0.0.0.0'

// ─── Redis ────────────────────────────────────────────────────────────────────

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

const StreamKeys = {
  dashboard: (userId) => `stream:dashboard:${userId}`,
  agent: (machineId) => `stream:agent:${machineId}`,
  sessionLogs: (sessionId) => `session:logs:${sessionId}`,
  machineMetrics: (machineId) => `machine:metrics:${machineId}`,
}

const SESSION_LOG_MAX_LINES = 2000
const SESSION_LOG_TTL_SECONDS = 7 * 24 * 60 * 60

// ─── Session Recording ────────────────────────────────────────────────────────
// Plain-JS equivalents of src/lib/recording.ts — server.js is CJS and cannot
// import TypeScript modules directly at runtime.

const RECORDING_BUCKET = process.env.GCS_BUCKET_LOGS ?? 'sessionforge-logs'
const RECORDING_TTL_SECONDS = 365 * 24 * 60 * 60 // 1 year

// In-memory map: sessionId -> { startedAt: Date }
// Populated on session_started, consumed on session_stopped / session_crashed.
const sessionStartTimes = {}

function recordingRedisKey(sessionId) {
  return `recording:${sessionId}`
}

/**
 * Append one terminal output frame (base64-encoded) to the Redis recording buffer.
 * Mirrors recording.ts:appendRecordingFrame.
 */
async function appendRecordingFrame(sessionId, base64Data, sessionStartedAt) {
  try {
    const t = (Date.now() - sessionStartedAt.getTime()) / 1000
    const text = Buffer.from(base64Data, 'base64').toString('utf8')
    const frame = JSON.stringify([t, 'o', text])
    const key = recordingRedisKey(sessionId)
    await redis.lpush(key, frame)
    await redis.expire(key, RECORDING_TTL_SECONDS)
  } catch (err) {
    console.error('[recording] appendRecordingFrame error:', err)
  }
}

/**
 * Archive the Redis recording buffer for a session to GCS as asciinema v2 .cast.gz.
 * Mirrors recording.ts:archiveSessionRecording.
 */
async function archiveSessionRecording(sessionId, orgId, startedAt, width = 220, height = 50) {
  try {
    const key = recordingRedisKey(sessionId)
    const frames = await redis.lrange(key, 0, -1)
    if (!frames || frames.length === 0) return

    // lpush stores newest first — reverse for chronological order
    const chronological = [...frames].reverse()
    const lastFrame = JSON.parse(chronological[chronological.length - 1])
    const durationSeconds = lastFrame[0]

    const header = JSON.stringify({
      version: 2,
      width,
      height,
      timestamp: Math.floor(startedAt.getTime() / 1000),
      duration: durationSeconds,
      title: `Session ${sessionId}`,
    })

    const cast = [header, ...chronological].join('\n') + '\n'
    const compressed = await gzip(Buffer.from(cast, 'utf8'))

    const { Storage } = require('@google-cloud/storage')
    const storage = new Storage()
    const gcsPath = `session-recordings/${orgId}/${sessionId}.cast.gz`
    await storage
      .bucket(RECORDING_BUCKET)
      .file(gcsPath)
      .save(compressed, {
        metadata: { contentType: 'application/gzip', contentEncoding: 'gzip' },
      })

    await redis.del(key)
    console.log(`[recording] archived session ${sessionId} → gs://${RECORDING_BUCKET}/${gcsPath}`)
  } catch (err) {
    console.error('[recording] archiveSessionRecording error:', err)
  }
}

// ─── DB ───────────────────────────────────────────────────────────────────────

function buildSql(connectionString) {
  const hostMatch = connectionString.match(/[?&]host=([^&]+)/)
  if (hostMatch) {
    const socketPath = decodeURIComponent(hostMatch[1])
    const credMatch = connectionString.match(/^postgresql?:\/\/([^:]+):([^@]+)@\/([^?]+)/)
    if (credMatch) {
      const [, user, password, database] = credMatch
      return postgres({
        host: socketPath,
        user: decodeURIComponent(user),
        password: decodeURIComponent(password),
        database,
        max: 5,
      })
    }
  }
  return postgres(connectionString, { max: 5 })
}

let sql
function getDb() {
  if (!sql) sql = buildSql(process.env.DATABASE_URL)
  return sql
}

async function query(sqlStr, params = []) {
  return getDb().unsafe(sqlStr, params)
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

// Lazily cache the getToken import (ESM module loaded once into CJS)
let _getToken = null
async function loadGetToken() {
  if (!_getToken) {
    const mod = await import('next-auth/jwt')
    _getToken = mod.getToken
  }
  return _getToken
}

async function getUserIdFromCookie(req) {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!secret) return null
  const getToken = await loadGetToken()
  // next-auth/jwt getToken() accepts { headers: Record<string, string> }.
  // Try the secure-prefixed cookie first (production), then the unprefixed one (dev).
  const reqLike = { headers: req.headers }
  for (const secureCookie of [true, false]) {
    try {
      const token = await getToken({ req: reqLike, secret, secureCookie })
      if (token?.sub) return token.sub
    } catch {
      // Decryption failure with this cookie variant — try the next one
    }
  }
  return null
}

async function validateApiKey(rawKey) {
  if (!rawKey.startsWith('sf_live_')) return null
  const hash = createHash('sha256').update(rawKey).digest('hex')
  const rows = await query(
    `SELECT id, user_id, expires_at FROM api_keys WHERE key_hash = $1 LIMIT 1`,
    [hash]
  )
  const row = rows[0]
  if (!row) return null
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null
  await query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id])
  return { userId: row.user_id }
}

// ─── Redis Stream helpers ─────────────────────────────────────────────────────

async function publishToDashboard(userId, message) {
  const key = StreamKeys.dashboard(userId)
  await redis.xadd(key, '*', { data: JSON.stringify(message) })
  await redis.xtrim(key, { strategy: 'MAXLEN', threshold: 500 })
}

async function publishToAgent(machineId, message) {
  const key = StreamKeys.agent(machineId)
  await redis.xadd(key, '*', { data: JSON.stringify(message) })
  await redis.xtrim(key, { strategy: 'MAXLEN', threshold: 100 })
}

async function readStream(key, lastId) {
  const result = await redis.xread(key, lastId, { count: 20 })
  if (!result || result.length === 0) return [lastId, []]
  // @upstash/redis xread returns: [[streamName, [[id, [field, parsedValue]], ...]]]
  // Each entry: e[0] = message id, e[1] = [field, parsedValue] flat array.
  // The SDK auto-parses the value from JSON, so e[1][1] is already an object.
  // We re-serialize it to a JSON string for ws.send().
  const entries = result[0]?.[1] ?? []
  if (entries.length === 0) return [lastId, []]
  const newLastId = entries[entries.length - 1][0]
  const messages = entries
    .map((e) => {
      const val = e[1]?.[1] // parsedValue at index 1 of the [field, value] array
      if (val === undefined || val === null) return null
      return typeof val === 'string' ? val : JSON.stringify(val)
    })
    .filter(Boolean)
  return [newLastId, messages]
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getSessionRecord(sessionId, userId) {
  const rows = await query(
    `SELECT id, machine_id, status FROM sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [sessionId, userId]
  )
  return rows[0] ?? null
}

async function getMachineUserId(machineId) {
  if (!machineId) return null
  const rows = await query(`SELECT user_id FROM machines WHERE id = $1 LIMIT 1`, [machineId])
  return rows[0]?.user_id ?? null
}

// ─── Webhook delivery (plain-JS equivalent of src/lib/webhook-delivery.ts) ───
// server.js is CJS and cannot import TypeScript modules at runtime, so the
// delivery logic is inlined here using the existing query() helper.

const WEBHOOK_MAX_ATTEMPTS = 3
const WEBHOOK_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000]

async function deliverWebhook(event, payload, userId, orgId) {
  let whereClause, params
  if (orgId) {
    whereClause = `(user_id = $1 OR org_id = $2) AND enabled = true`
    params = [userId, orgId]
  } else {
    whereClause = `user_id = $1 AND enabled = true`
    params = [userId]
  }
  const targets = await query(`SELECT * FROM webhooks WHERE ${whereClause}`, params).catch(() => [])
  const subscribed = targets.filter(
    (w) => (w.events ?? []).includes(event) || (w.events ?? []).includes('*')
  )
  if (subscribed.length === 0) return

  const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() })
  await Promise.allSettled(subscribed.map((w) => _attemptWebhookDelivery(w, event, body, payload)))
}

async function _attemptWebhookDelivery(webhook, event, body, payload) {
  const { createHmac } = require('crypto')
  const sig = `sha256=${createHmac('sha256', webhook.secret).update(body).digest('hex')}`

  const [delivery] = await query(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, status, attempts)
     VALUES ($1, $2, $3, 'pending', 0) RETURNING id`,
    [webhook.id, event, JSON.stringify(payload)]
  ).catch(() => [null])
  if (!delivery) return

  await _sendWebhookWithRetry(webhook.url, body, sig, delivery.id, 1, event)
}

async function _sendWebhookWithRetry(url, body, signature, deliveryId, attempt, event) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SessionForge-Signature': signature,
        'X-SessionForge-Event': event,
        'User-Agent': 'SessionForge-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))
    const responseBody = await res.text().catch(() => '')
    await query(
      `UPDATE webhook_deliveries SET status = $1, response_code = $2, response_body = $3,
       attempts = $4, last_attempt_at = NOW() WHERE id = $5`,
      [
        res.ok ? 'delivered' : 'failed',
        res.status,
        responseBody.slice(0, 1000),
        attempt,
        deliveryId,
      ]
    ).catch(() => {})
    if (!res.ok && attempt < WEBHOOK_MAX_ATTEMPTS) {
      setTimeout(
        () => _sendWebhookWithRetry(url, body, signature, deliveryId, attempt + 1, event),
        WEBHOOK_RETRY_DELAYS_MS[attempt - 1]
      )
    }
  } catch {
    await query(
      `UPDATE webhook_deliveries SET status = $1, attempts = $2, last_attempt_at = NOW() WHERE id = $3`,
      [attempt >= WEBHOOK_MAX_ATTEMPTS ? 'failed' : 'pending', attempt, deliveryId]
    ).catch(() => {})
    if (attempt < WEBHOOK_MAX_ATTEMPTS) {
      setTimeout(
        () => _sendWebhookWithRetry(url, body, signature, deliveryId, attempt + 1, event),
        WEBHOOK_RETRY_DELAYS_MS[attempt - 1]
      )
    }
  }
}

// ─── Dashboard WS ─────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 150
const PING_INTERVAL_MS = 30_000
const { WebSocket } = require('ws')

function handleDashboardWs(ws, userId) {
  let lastId = '$'
  let pollTimer = null
  let pingTimer = null

  // Push cached machine metrics immediately on connect so the client doesn't
  // have to wait up to 30 s for the next heartbeat to see Live CPU / Memory.
  async function pushInitialMetrics() {
    try {
      const machines = await query(
        `SELECT id FROM machines WHERE user_id = $1 AND status = 'online'`,
        [userId]
      )
      await Promise.all(
        machines.map(async (m) => {
          const cached = await redis.get(StreamKeys.machineMetrics(m.id))
          if (!cached) return
          const metrics = typeof cached === 'string' ? JSON.parse(cached) : cached
          if (ws.readyState !== WebSocket.OPEN) return
          ws.send(
            JSON.stringify({
              type: 'machine_updated',
              machine: {
                id: m.id,
                status: 'online',
                cpu: metrics.cpu,
                memory: metrics.memory,
                disk: metrics.disk,
                sessionCount: metrics.sessionCount,
                discoveredProcesses: metrics.discoveredProcesses ?? [],
              },
            })
          )
        })
      )
    } catch {
      /* non-critical, poll will catch up */
    }
  }

  async function poll() {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      const [newLastId, messages] = await readStream(StreamKeys.dashboard(userId), lastId)
      lastId = newLastId
      for (const msg of messages) {
        if (ws.readyState !== WebSocket.OPEN) break
        // Filter session_output: only forward if the client has no subscription
        // (backwards compat) or if the subscribed sessionId matches.
        if (ws.subscribedSessionId) {
          try {
            const parsed = JSON.parse(msg)
            if (parsed.type === 'session_output' && parsed.sessionId !== ws.subscribedSessionId)
              continue
          } catch {
            /* not valid JSON, forward as-is */
          }
        }
        ws.send(msg)
      }
    } catch {
      /* transient */
    }
    if (ws.readyState === WebSocket.OPEN) {
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
    }
  }

  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }))
  }, PING_INTERVAL_MS)

  ws.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    switch (msg.type) {
      case 'ping':
        break
      case 'subscribe_session': {
        if (!msg.sessionId) break
        ws.subscribedSessionId = msg.sessionId
        // Replay ring buffer so the client sees output that arrived before this WS connected.
        try {
          const logKey = StreamKeys.sessionLogs(msg.sessionId)
          const lines = await redis.lrange(logKey, 0, -1)
          if (lines && lines.length > 0 && ws.readyState === WebSocket.OPEN) {
            // Logs stored via rpush — lrange(0,-1) returns chronological order (oldest→newest)
            for (const line of lines) {
              ws.send(
                JSON.stringify({ type: 'session_output', sessionId: msg.sessionId, data: line })
              )
            }
          }
        } catch {
          /* non-critical — live stream will catch up */
        }
        break
      }
      case 'session_input': {
        if (!msg.sessionId || !msg.data) {
          console.warn('[ws/dashboard] session_input missing sessionId or data')
          break
        }
        // C4: Reject oversized or non-string payloads before touching the DB.
        // 8192 bytes covers any realistic terminal paste; larger values indicate
        // a bug or abuse attempt and should be dropped rather than forwarded.
        if (typeof msg.data !== 'string' || msg.data.length > 8192) {
          console.warn('[ws/dashboard] session_input too large or invalid, dropping')
          break
        }
        const record = await getSessionRecord(msg.sessionId, userId)
        if (!record) {
          console.warn(
            '[ws/dashboard] session_input: session not found',
            msg.sessionId,
            'userId',
            userId
          )
          break
        }
        if (record.status !== 'running') {
          console.warn(
            '[ws/dashboard] session_input: session not running, status=',
            record.status,
            'sessionId',
            msg.sessionId
          )
          break
        }
        console.log(
          '[ws/dashboard] session_input forwarding to agent, sessionId',
          msg.sessionId,
          'machineId',
          record.machine_id
        )
        await publishToAgent(record.machine_id, {
          type: 'session_input',
          sessionId: msg.sessionId,
          data: msg.data,
        })
        break
      }
      case 'resize': {
        if (!msg.sessionId || !msg.cols || !msg.rows) break
        const record = await getSessionRecord(msg.sessionId, userId)
        if (!record || record.status !== 'running') break
        await publishToAgent(record.machine_id, {
          type: 'resize',
          sessionId: msg.sessionId,
          cols: msg.cols,
          rows: msg.rows,
        })
        break
      }
    }
  })

  ws.on('close', () => {
    if (pollTimer) clearTimeout(pollTimer)
    if (pingTimer) clearInterval(pingTimer)
  })

  pushInitialMetrics()
  poll()
}

// ─── Agent WS ─────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000
const AGENT_TIMEOUT_MS = 90_000

function handleAgentWs(ws, userId, remoteAddress) {
  let machineId = null
  let machineHostname = null
  let lastHeartbeatAt = Date.now()
  let pingTimer = null
  let watchdogTimer = null
  let pollTimer = null
  let watchdogFired = false
  // Use a timestamp-based ID rather than '$' so non-blocking xread works correctly.
  // '$' with the Upstash REST API always returns null (it means "newer than the absolute
  // latest at query time"), whereas a concrete millisecond ID means "newer than this".
  let agentPollLastId = `${Date.now()}-0`
  // Per-session stats accumulator: sessionId -> { peakMemory, cpuTotal, cpuSamples }
  const sessionStats = {}

  async function pollAgentCommands() {
    if (!machineId || ws.readyState !== WebSocket.OPEN) return
    try {
      const [newLastId, messages] = await readStream(StreamKeys.agent(machineId), agentPollLastId)
      agentPollLastId = newLastId
      for (const msg of messages) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg)
      }
    } catch (pollErr) {
      console.error('[ws/agent] poll error:', pollErr?.message ?? pollErr)
    }
    if (ws.readyState === WebSocket.OPEN) {
      pollTimer = setTimeout(pollAgentCommands, POLL_INTERVAL_MS)
    }
  }

  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
  }, HEARTBEAT_INTERVAL_MS)

  watchdogTimer = setInterval(async () => {
    if (Date.now() - lastHeartbeatAt > AGENT_TIMEOUT_MS && machineId) {
      await query(`UPDATE machines SET status = 'offline', updated_at = NOW() WHERE id = $1`, [
        machineId,
      ]).catch(console.error)
      watchdogFired = true
      try {
        const machineRows = await query(
          `SELECT name, hostname FROM machines WHERE id = $1 LIMIT 1`,
          [machineId]
        )
        const machineName = machineRows[0]?.name ?? machineId
        const machineHostname = machineRows[0]?.hostname ?? machineName
        await query(
          `INSERT INTO notifications (id, user_id, type, title, body, resource_id, created_at)
           VALUES (gen_random_uuid(), $1, 'machine_offline', 'Machine went offline', $2, $3, NOW())`,
          [userId, `${machineName} (${machineHostname}) stopped responding`, machineId]
        )
      } catch (err) {
        console.error('[notifications] failed to create offline notification:', err)
      }
    }
  }, HEARTBEAT_INTERVAL_MS)

  ws.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type !== 'heartbeat') {
      console.log('[ws/agent] recv type:', msg.type)
    }
    try {
      await handleAgentMessage(msg, userId, remoteAddress, sessionStats, (id, hn) => {
        machineId = id
        if (hn) machineHostname = hn
        lastHeartbeatAt = Date.now()
        if (!pollTimer) {
          console.log(`[ws/agent] starting poll for machine ${id}`)
          pollAgentCommands()
        }
      })
      if (msg.type === 'heartbeat') lastHeartbeatAt = Date.now()
    } catch (err) {
      console.error('[ws/agent] error handling message:', msg.type, err)
    }
  })

  ws.on('close', async () => {
    if (pingTimer) clearInterval(pingTimer)
    if (watchdogTimer) clearInterval(watchdogTimer)
    if (pollTimer) clearTimeout(pollTimer)
    if (machineId) {
      await query(`UPDATE machines SET status = 'offline', updated_at = NOW() WHERE id = $1`, [
        machineId,
      ]).catch(console.error)
      if (!watchdogFired) {
        try {
          const machineRows = await query(
            `SELECT name, hostname FROM machines WHERE id = $1 LIMIT 1`,
            [machineId]
          )
          const machineName = machineRows[0]?.name ?? machineId
          const machineHostname = machineRows[0]?.hostname ?? machineName
          await query(
            `INSERT INTO notifications (id, user_id, type, title, body, resource_id, created_at)
             VALUES (gen_random_uuid(), $1, 'machine_offline', 'Machine went offline', $2, $3, NOW())`,
            [userId, `${machineName} (${machineHostname}) stopped responding`, machineId]
          )
        } catch (err) {
          console.error('[notifications] failed to create offline notification:', err)
        }
        try {
          const machineRows = await query(`SELECT hostname FROM machines WHERE id = $1 LIMIT 1`, [
            machineId,
          ]).catch(() => [])
          await deliverWebhook(
            'machine.offline',
            { machineId, hostname: machineRows[0]?.hostname ?? null },
            userId
          )
        } catch (err) {
          console.error('[webhooks] delivery error on machine.offline:', err)
        }
      }
    }
  })
}

// flushSessionStats writes accumulated peak_memory_mb and avg_cpu_percent to the DB
// for a given sessionId, then removes the entry from the in-memory accumulator.
async function flushSessionStats(sessionId, sessionStats) {
  const stats = sessionStats[sessionId]
  if (!stats) return
  delete sessionStats[sessionId]
  const peakMemory = stats.peakMemory ?? null
  const avgCpu = stats.cpuSamples > 0 ? stats.cpuTotal / stats.cpuSamples : null
  if (peakMemory !== null || avgCpu !== null) {
    await query(`UPDATE sessions SET peak_memory_mb = $1, avg_cpu_percent = $2 WHERE id = $3`, [
      peakMemory,
      avgCpu,
      sessionId,
    ]).catch(console.error)
  }
}

async function handleAgentMessage(msg, userId, remoteAddress, sessionStats, onMachineId) {
  switch (msg.type) {
    case 'register': {
      const { machineId, name, os, hostname: h, version, cpuModel, ramGb } = msg
      if (!['windows', 'macos', 'linux'].includes(os)) return
      // Extract a clean IP: strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 -> 1.2.3.4)
      const rawIp = remoteAddress ?? null
      const ipAddress = rawIp ? rawIp.replace(/^::ffff:/, '') : null
      await query(
        `INSERT INTO machines (id, user_id, name, os, hostname, agent_version, ip_address, cpu_model, ram_gb, status, last_seen, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'online', NOW(), NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, hostname = EXCLUDED.hostname,
           agent_version = EXCLUDED.agent_version, ip_address = EXCLUDED.ip_address,
           cpu_model = EXCLUDED.cpu_model, ram_gb = EXCLUDED.ram_gb,
           status = 'online', last_seen = NOW(), updated_at = NOW()`,
        [machineId, userId, name, os, h, version, ipAddress, cpuModel ?? null, ramGb ?? null]
      )
      onMachineId(machineId, h)
      await publishToDashboard(userId, {
        type: 'machine_updated',
        machine: { id: machineId, status: 'online', cpu: 0, memory: 0 },
      })
      try {
        await deliverWebhook('machine.online', { machineId, hostname: h }, userId)
      } catch (err) {
        console.error('[webhooks] delivery error on machine.online:', err)
      }
      break
    }

    case 'pong':
      break

    case 'heartbeat': {
      const { machineId, cpu, memory, disk, sessionCount, discoveredProcesses } = msg
      if (!machineId) break // guard against bare heartbeat responses
      await Promise.all([
        query(
          `UPDATE machines SET last_seen = NOW(), status = 'online', updated_at = NOW() WHERE id = $1`,
          [machineId]
        ),
        redis.setex(
          StreamKeys.machineMetrics(machineId),
          120,
          JSON.stringify({
            cpu,
            memory,
            disk,
            sessionCount,
            discoveredProcesses: discoveredProcesses ?? [],
            ts: Date.now(),
          })
        ),
      ])
      await publishToDashboard(userId, {
        type: 'machine_updated',
        machine: {
          id: machineId,
          status: 'online',
          cpu,
          memory,
          disk,
          sessionCount,
          discoveredProcesses: discoveredProcesses ?? [],
        },
      })

      // Update per-session stats accumulators for any running sessions on this machine.
      if (machineId && (cpu != null || memory != null)) {
        const runningSessions = await query(
          `SELECT id FROM sessions WHERE machine_id = $1 AND status = 'running'`,
          [machineId]
        ).catch(() => [])
        for (const row of runningSessions) {
          const sid = row.id
          if (!sessionStats[sid]) sessionStats[sid] = { peakMemory: 0, cpuTotal: 0, cpuSamples: 0 }
          const s = sessionStats[sid]
          // memory from heartbeat is a percentage (0-100); store as-is in peak_memory_mb field
          // (column is named peak_memory_mb but we store percentage since we don't have absolute MB here)
          if (memory != null && memory > s.peakMemory) s.peakMemory = memory
          if (cpu != null) {
            s.cpuTotal += cpu
            s.cpuSamples++
          }
        }
      }
      break
    }

    case 'session_started': {
      const { session: s } = msg
      console.log(
        '[ws/agent] session_started sessionId',
        s.id,
        'pid',
        s.pid,
        'command',
        s.processName
      )

      // C3: Pre-allocate the ring buffer key so any dashboard subscriber that
      // calls lrange() immediately after subscribe_session sees an existing key
      // rather than nil. Without this, output that arrives before the dashboard
      // WS calls subscribe_session is flushed into a key that didn't exist yet,
      // and lrange returns [] — causing the client to miss early output.
      const logKey = StreamKeys.sessionLogs(s.id)
      await redis.expire(logKey, SESSION_LOG_TTL_SECONDS).catch(() => {})

      // Upsert: dashboard-started sessions already have a row (UPDATE path).
      // CLI-started sessions (sessionforge run) have no prior row (INSERT path).
      await query(
        `INSERT INTO sessions (id, machine_id, user_id, pid, process_name, workdir, status, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'running', $7)
         ON CONFLICT (id) DO UPDATE
           SET pid = EXCLUDED.pid,
               process_name = EXCLUDED.process_name,
               workdir = EXCLUDED.workdir,
               status = 'running',
               started_at = EXCLUDED.started_at`,
        [s.id, machineId, userId, s.pid, s.processName, s.workdir, new Date(s.startedAt)]
      )
      // Track session start time for recording frame timestamps
      sessionStartTimes[s.id] = new Date(s.startedAt)
      const rows = await query(`SELECT machine_id FROM sessions WHERE id = $1 LIMIT 1`, [s.id])
      if (rows[0])
        await publishToDashboard(userId, {
          type: 'session_updated',
          session: { id: s.id, status: 'running', machineId: rows[0].machine_id },
        })
      try {
        await deliverWebhook(
          'session.started',
          { sessionId: s.id, machineId: rows[0]?.machine_id ?? null },
          userId
        )
      } catch (err) {
        console.error('[webhooks] delivery error on session.started:', err)
      }
      break
    }

    case 'session_stopped': {
      const { sessionId, exitCode } = msg
      await flushSessionStats(sessionId, sessionStats)
      await query(
        `UPDATE sessions SET status = 'stopped', exit_code = $1, stopped_at = NOW() WHERE id = $2`,
        [exitCode, sessionId]
      )
      const rows = await query(`SELECT machine_id, user_id FROM sessions WHERE id = $1 LIMIT 1`, [
        sessionId,
      ])
      if (rows[0]) {
        await publishToDashboard(userId, {
          type: 'session_updated',
          session: { id: sessionId, status: 'stopped', machineId: rows[0].machine_id },
        })
        // Archive recording to GCS if the machine has an org (enterprise plan check happens at playback)
        const orgRows = await query(`SELECT org_id FROM machines WHERE id = $1 LIMIT 1`, [
          rows[0].machine_id,
        ]).catch(() => [])
        if (orgRows[0]?.org_id) {
          const startedAt = sessionStartTimes[sessionId] ?? new Date()
          delete sessionStartTimes[sessionId]
          archiveSessionRecording(sessionId, orgRows[0].org_id, startedAt).catch(console.error)
        }
      }
      try {
        await deliverWebhook(
          'session.stopped',
          { sessionId, machineId: rows[0]?.machine_id ?? null },
          userId
        )
      } catch (err) {
        console.error('[webhooks] delivery error on session.stopped:', err)
      }
      try {
        const { redis: redisLib, RedisKeys } = await import('./src/lib/redis.js')
        const { archiveSessionLogs } = await import('./src/lib/gcs-logs.js')
        const logKey = RedisKeys.sessionLogs(sessionId)
        const lines = await redisLib.lrange(logKey, 0, -1)
        if (lines.length > 0) {
          // Use user_id from the session row rather than the WebSocket-authenticated userId.
          // In the agent→server message flow the outer userId is the machine owner resolved
          // via the API key; sourcing it from the session row is more correct and defensive.
          // Fallback to the WS-auth userId in case the row is somehow absent.
          await archiveSessionLogs(sessionId, rows[0]?.user_id ?? userId, lines)
        }
      } catch (err) {
        console.error('[gcs-logs] archive failed for session', sessionId, ':', err)
      }
      break
    }

    case 'session_crashed': {
      const { sessionId, error } = msg
      await flushSessionStats(sessionId, sessionStats)
      await query(`UPDATE sessions SET status = 'crashed', stopped_at = NOW() WHERE id = $1`, [
        sessionId,
      ])
      const rows = await query(`SELECT machine_id FROM sessions WHERE id = $1 LIMIT 1`, [sessionId])
      if (rows[0]) {
        await publishToDashboard(userId, {
          type: 'session_updated',
          session: { id: sessionId, status: 'crashed', machineId: rows[0].machine_id },
        })
        await publishToDashboard(userId, {
          type: 'alert_fired',
          alertId: crypto.randomUUID(),
          message: `Session crashed: ${error}`,
          severity: 'warning',
        })
        // Archive recording to GCS even on crash
        const orgRows = await query(`SELECT org_id FROM machines WHERE id = $1 LIMIT 1`, [
          rows[0].machine_id,
        ]).catch(() => [])
        if (orgRows[0]?.org_id) {
          const startedAt = sessionStartTimes[sessionId] ?? new Date()
          delete sessionStartTimes[sessionId]
          archiveSessionRecording(sessionId, orgRows[0].org_id, startedAt).catch(console.error)
        }
      }
      // Notify the session owner
      try {
        await query(
          `INSERT INTO notifications (id, user_id, type, title, body, resource_id, created_at)
           VALUES (gen_random_uuid(), $1, 'session_crashed', 'Session crashed', $2, $3, NOW())`,
          [
            userId,
            `Session ${sessionId} exited unexpectedly${error ? `: ${error}` : ''}`,
            sessionId,
          ]
        )
      } catch (err) {
        console.error('[notifications] failed to create crash notification:', err)
      }
      try {
        await deliverWebhook(
          'session.crashed',
          { sessionId, machineId: rows[0]?.machine_id ?? null },
          userId
        )
      } catch (err) {
        console.error('[webhooks] delivery error on session.crashed:', err)
      }
      break
    }

    case 'session_output': {
      const { sessionId, data } = msg
      const logKey = StreamKeys.sessionLogs(sessionId)
      await redis.rpush(logKey, data)
      await redis.ltrim(logKey, -SESSION_LOG_MAX_LINES, -1)
      await redis.expire(logKey, SESSION_LOG_TTL_SECONDS)
      // Append frame to recording buffer (fire-and-forget; errors are logged inside)
      const startedAt = sessionStartTimes[sessionId]
      if (startedAt) appendRecordingFrame(sessionId, data, startedAt).catch(console.error)
      const rows = await query(`SELECT machine_id FROM sessions WHERE id = $1 LIMIT 1`, [sessionId])
      const ownerUserId = await getMachineUserId(rows[0]?.machine_id)
      console.log(
        '[ws/agent] session_output sessionId',
        sessionId,
        'ownerUserId',
        ownerUserId,
        'dataLen',
        data?.length
      )
      if (ownerUserId)
        await publishToDashboard(ownerUserId, { type: 'session_output', sessionId, data })
      break
    }
  }
}

// ─── HTTP proxy helpers ───────────────────────────────────────────────────────

function proxyRequest(req, res) {
  const options = {
    hostname: '127.0.0.1',
    port: INTERNAL_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res, { end: true })
  })
  proxyReq.on('error', (err) => {
    console.error('[proxy] error:', err.message)
    if (!res.headersSent) {
      res.writeHead(502)
      res.end('Bad Gateway')
    }
  })
  req.pipe(proxyReq, { end: true })
}

function proxyUpgrade(req, socket, head) {
  const proxySocket = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
    proxySocket.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.entries(req.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        '\r\n\r\n'
    )
    proxySocket.write(head)
    socket.pipe(proxySocket)
    proxySocket.pipe(socket)
  })
  proxySocket.on('error', (err) => {
    console.error('[proxy-ws] error:', err.message)
    socket.destroy()
  })
  socket.on('error', () => proxySocket.destroy())
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Start Next.js on internal port
  const { startServer } = require('next/dist/server/lib/start-server')

  // Load the embedded nextConfig from next-config.json (extracted by Dockerfile)
  // so startServer can find it without a next.config.js on disk.
  if (!process.env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
    try {
      const fs = require('fs')
      const configJson = fs.readFileSync(path.join(__dirname, 'next-config.json'), 'utf8')
      process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = configJson
    } catch (e) {
      console.warn(
        '[server] next-config.json not found, startServer will try to read next.config.js:',
        e.message
      )
    }
  }

  require('next') // ensure next module is initialised before startServer

  console.log(`> Starting Next.js internally on port ${INTERNAL_PORT}...`)
  startServer({
    dir,
    isDev: false,
    hostname: '127.0.0.1',
    port: INTERNAL_PORT,
    allowRetry: false,
  }).catch((err) => {
    console.error('[next] startServer error:', err)
    process.exit(1)
  })

  // 2. Wait briefly for Next.js to be ready before accepting external traffic
  await new Promise((resolve) => {
    let attempts = 0
    const check = () => {
      const probe = net.connect(INTERNAL_PORT, '127.0.0.1')
      probe.on('connect', () => {
        probe.destroy()
        resolve()
      })
      probe.on('error', () => {
        if (++attempts < 60) setTimeout(check, 500)
        else {
          console.error('[next] timed out waiting for Next.js to start')
          process.exit(1)
        }
      })
    }
    setTimeout(check, 1000)
  })

  console.log(`> Next.js ready on internal port ${INTERNAL_PORT}`)

  // 3. Set up our WebSocket servers
  const wsDashboard = new WebSocketServer({ noServer: true })
  const wsAgent = new WebSocketServer({ noServer: true })

  wsDashboard.on('connection', (ws, req) => {
    console.log(`[ws/dashboard] connected userId=${req._userId}`)
    handleDashboardWs(ws, req._userId)
  })

  wsAgent.on('connection', (ws, req) => {
    console.log(`[ws/agent] connected userId=${req._userId} ip=${req._remoteAddress ?? 'unknown'}`)
    handleAgentWs(ws, req._userId, req._remoteAddress)
  })

  // 4. Create our public-facing HTTP server
  const server = http.createServer((req, res) => {
    proxyRequest(req, res)
  })

  server.on('upgrade', async (req, socket, head) => {
    const { pathname } = parse(req.url ?? '/')

    if (pathname === '/api/ws/dashboard') {
      const userId = await getUserIdFromCookie(req)
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      req._userId = userId
      wsDashboard.handleUpgrade(req, socket, head, (ws) => wsDashboard.emit('connection', ws, req))
      return
    }

    if (pathname === '/api/ws/agent') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const apiKey = url.searchParams.get('key')
      if (!apiKey) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      const validKey = await validateApiKey(apiKey)
      if (!validKey) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      req._userId = validKey.userId
      // Capture remote IP: prefer X-Forwarded-For (set by load balancers/proxies) then socket address.
      req._remoteAddress =
        (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
        req.socket.remoteAddress ||
        null
      wsAgent.handleUpgrade(req, socket, head, (ws) => wsAgent.emit('connection', ws, req))
      return
    }

    // Proxy all other WS upgrades to Next.js (e.g. HMR in dev)
    proxyUpgrade(req, socket, head)
  })

  server.listen(PORT, hostname, () => {
    console.log(`> SessionForge ready on http://${hostname}:${PORT}`)
  })
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
