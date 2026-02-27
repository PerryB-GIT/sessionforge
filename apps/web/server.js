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
const { WebSocketServer } = require('ws')
const { Redis } = require('@upstash/redis')
const { createHash } = require('crypto')
const postgres = require('postgres')

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
  agent:     (machineId) => `stream:agent:${machineId}`,
  sessionLogs: (sessionId) => `session:logs:${sessionId}`,
  machineMetrics: (machineId) => `machine:metrics:${machineId}`,
}

const SESSION_LOG_MAX_LINES = 2000
const SESSION_LOG_TTL_SECONDS = 7 * 24 * 60 * 60

// ─── DB ───────────────────────────────────────────────────────────────────────

function buildSql(connectionString) {
  const hostMatch = connectionString.match(/[?&]host=([^&]+)/)
  if (hostMatch) {
    const socketPath = decodeURIComponent(hostMatch[1])
    const credMatch = connectionString.match(/^postgresql?:\/\/([^:]+):([^@]+)@\/([^?]+)/)
    if (credMatch) {
      const [, user, password, database] = credMatch
      return postgres({ host: socketPath, user: decodeURIComponent(user), password: decodeURIComponent(password), database, max: 5 })
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

async function getUserIdFromCookie(cookieHeader) {
  if (!cookieHeader) return null
  const cookieName = '__Secure-authjs.session-token'
  const cookieNameDev = 'authjs.session-token'
  // Try secure first, then dev
  let match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName.replace('.', '\\.')}=([^;]+)`))
  if (!match?.[1]) {
    match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieNameDev.replace('.', '\\.')}=([^;]+)`))
  }
  if (!match?.[1]) return null
  const token = decodeURIComponent(match[1])
  try {
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    return payload.sub ?? null
  } catch {
    return null
  }
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
  await redis.xtrim(key, { kind: 'MAXLEN', threshold: 500 })
}

async function publishToAgent(machineId, message) {
  const key = StreamKeys.agent(machineId)
  await redis.xadd(key, '*', { data: JSON.stringify(message) })
  await redis.xtrim(key, { kind: 'MAXLEN', threshold: 100 })
}

async function readStream(key, lastId) {
  const result = await redis.xread({ key, id: lastId }, { count: 20 })
  if (!result || result.length === 0) return [lastId, []]
  const entries = result[0]?.messages ?? []
  if (entries.length === 0) return [lastId, []]
  const newLastId = entries[entries.length - 1].id
  const messages = entries.map((e) => e.message.data)
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

// ─── Dashboard WS ─────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 150
const PING_INTERVAL_MS = 30_000
const { WebSocket } = require('ws')

function handleDashboardWs(ws, userId) {
  let lastId = '$'
  let pollTimer = null
  let pingTimer = null

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
            if (parsed.type === 'session_output' && parsed.sessionId !== ws.subscribedSessionId) continue
          } catch { /* not valid JSON, forward as-is */ }
        }
        ws.send(msg)
      }
    } catch { /* transient */ }
    if (ws.readyState === WebSocket.OPEN) {
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
    }
  }

  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }))
  }, PING_INTERVAL_MS)

  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    switch (msg.type) {
      case 'ping': break
      case 'subscribe_session': {
        if (!msg.sessionId) break
        ws.subscribedSessionId = msg.sessionId
        break
      }
      case 'session_input': {
        if (!msg.sessionId || !msg.data) break
        const record = await getSessionRecord(msg.sessionId, userId)
        if (!record || record.status !== 'running') break
        await publishToAgent(record.machine_id, { type: 'session_input', sessionId: msg.sessionId, data: msg.data })
        break
      }
      case 'resize': {
        if (!msg.sessionId || !msg.cols || !msg.rows) break
        const record = await getSessionRecord(msg.sessionId, userId)
        if (!record || record.status !== 'running') break
        await publishToAgent(record.machine_id, { type: 'resize', sessionId: msg.sessionId, cols: msg.cols, rows: msg.rows })
        break
      }
    }
  })

  ws.on('close', () => {
    if (pollTimer) clearTimeout(pollTimer)
    if (pingTimer) clearInterval(pingTimer)
  })

  poll()
}

// ─── Agent WS ─────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000
const AGENT_TIMEOUT_MS = 90_000

function handleAgentWs(ws, userId, remoteAddress) {
  let machineId = null
  let lastHeartbeatAt = Date.now()
  let pingTimer = null
  let watchdogTimer = null
  let pollTimer = null
  let agentPollLastId = '$'
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
    } catch { /* transient */ }
    if (ws.readyState === WebSocket.OPEN) {
      pollTimer = setTimeout(pollAgentCommands, POLL_INTERVAL_MS)
    }
  }

  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
  }, HEARTBEAT_INTERVAL_MS)

  watchdogTimer = setInterval(async () => {
    if (Date.now() - lastHeartbeatAt > AGENT_TIMEOUT_MS && machineId) {
      await query(`UPDATE machines SET status = 'offline', updated_at = NOW() WHERE id = $1`, [machineId]).catch(console.error)
    }
  }, HEARTBEAT_INTERVAL_MS)

  ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    try {
      await handleAgentMessage(msg, userId, remoteAddress, sessionStats, (id) => {
        machineId = id
        lastHeartbeatAt = Date.now()
        if (!pollTimer) pollAgentCommands()
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
      await query(`UPDATE machines SET status = 'offline', updated_at = NOW() WHERE id = $1`, [machineId]).catch(console.error)
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
    await query(
      `UPDATE sessions SET peak_memory_mb = $1, avg_cpu_percent = $2 WHERE id = $3`,
      [peakMemory, avgCpu, sessionId]
    ).catch(console.error)
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
      onMachineId(machineId)
      await publishToDashboard(userId, { type: 'machine_updated', machine: { id: machineId, status: 'online', cpu: 0, memory: 0 } })
      break
    }

    case 'heartbeat': {
      const { machineId, cpu, memory, disk, sessionCount } = msg
      await Promise.all([
        query(`UPDATE machines SET last_seen = NOW(), status = 'online', updated_at = NOW() WHERE id = $1`, [machineId]),
        redis.setex(StreamKeys.machineMetrics(machineId), 120, JSON.stringify({ cpu, memory, disk, sessionCount, ts: Date.now() })),
      ])
      await publishToDashboard(userId, { type: 'machine_updated', machine: { id: machineId, status: 'online', cpu, memory, disk, sessionCount } })

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
          if (cpu != null) { s.cpuTotal += cpu; s.cpuSamples++ }
        }
      }
      break
    }

    case 'session_started': {
      const { session: s } = msg
      await query(
        `UPDATE sessions SET pid = $1, process_name = $2, workdir = $3, status = 'running', started_at = $4 WHERE id = $5`,
        [s.pid, s.processName, s.workdir, new Date(s.startedAt), s.id]
      )
      const rows = await query(`SELECT machine_id FROM sessions WHERE id = $1 LIMIT 1`, [s.id])
      if (rows[0]) await publishToDashboard(userId, { type: 'session_updated', session: { id: s.id, status: 'running', machineId: rows[0].machine_id } })
      break
    }

    case 'session_stopped': {
      const { sessionId, exitCode } = msg
      await flushSessionStats(sessionId, sessionStats)
      await query(`UPDATE sessions SET status = 'stopped', exit_code = $1, stopped_at = NOW() WHERE id = $2`, [exitCode, sessionId])
      const rows = await query(`SELECT machine_id FROM sessions WHERE id = $1 LIMIT 1`, [sessionId])
      if (rows[0]) await publishToDashboard(userId, { type: 'session_updated', session: { id: sessionId, status: 'stopped', machineId: rows[0].machine_id } })
      break
    }

    case 'session_crashed': {
      const { sessionId, error } = msg
      await flushSessionStats(sessionId, sessionStats)
      await query(`UPDATE sessions SET status = 'crashed', stopped_at = NOW() WHERE id = $1`, [sessionId])
      const rows = await query(`SELECT machine_id FROM sessions WHERE id = $1 LIMIT 1`, [sessionId])
      if (rows[0]) {
        await publishToDashboard(userId, { type: 'session_updated', session: { id: sessionId, status: 'crashed', machineId: rows[0].machine_id } })
        await publishToDashboard(userId, { type: 'alert_fired', alertId: crypto.randomUUID(), message: `Session crashed: ${error}`, severity: 'warning' })
      }
      break
    }

    case 'session_output': {
      const { sessionId, data } = msg
      const logKey = StreamKeys.sessionLogs(sessionId)
      await redis.rpush(logKey, data)
      await redis.ltrim(logKey, -SESSION_LOG_MAX_LINES, -1)
      await redis.expire(logKey, SESSION_LOG_TTL_SECONDS)
      const rows = await query(`SELECT machine_id FROM sessions WHERE id = $1 LIMIT 1`, [sessionId])
      const ownerUserId = await getMachineUserId(rows[0]?.machine_id)
      if (ownerUserId) await publishToDashboard(ownerUserId, { type: 'session_output', sessionId, data })
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
      Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
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
      console.warn('[server] next-config.json not found, startServer will try to read next.config.js:', e.message)
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
      probe.on('connect', () => { probe.destroy(); resolve() })
      probe.on('error', () => {
        if (++attempts < 60) setTimeout(check, 500)
        else { console.error('[next] timed out waiting for Next.js to start'); process.exit(1) }
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
      const userId = await getUserIdFromCookie(req.headers.cookie)
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
      if (!apiKey) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
      const validKey = await validateApiKey(apiKey)
      if (!validKey) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
      req._userId = validKey.userId
      // Capture remote IP: prefer X-Forwarded-For (set by load balancers/proxies) then socket address.
      req._remoteAddress = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || null
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
