/**
 * Go Agent WS Connect Test (Node.js)
 * Tests the full API key → WebSocket auth flow against the live server.
 *
 * Run: node ws-connect-test.mjs [--key sf_live_xxx] [--url wss://...]
 *
 * If no --key is provided, generates a key directly in Cloud SQL
 * (requires Cloud SQL Auth Proxy on 127.0.0.1:5432).
 */

import { createHash, randomBytes } from 'crypto'
import { WebSocket } from 'ws'
import postgres from 'postgres'

const LIVE_URL = 'https://sessionforge-730654522335.us-central1.run.app'
const WS_URL  = LIVE_URL.replace('https://', 'wss://')
const DB_URL  = 'postgresql://sessionforge:H2nNfxVWBqUlIau7MZO8paTrK4qBIBYN@127.0.0.1:5432/sessionforge'

// ─── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
let existingKey = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key' && args[i + 1]) existingKey = args[i + 1]
  if (args[i] === '--url' && args[i + 1]) {
    // override WS_URL via arg if needed
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateKey() {
  const rand = randomBytes(24).toString('base64url')
  const key  = `sf_live_${rand}`
  const hash = createHash('sha256').update(key).digest('hex')
  const prefix = rand.slice(0, 8)
  return { key, hash, prefix }
}

function log(msg) { console.log(`[ws-test] ${msg}`) }
function err(msg) { console.error(`[ws-test] ERROR: ${msg}`) }

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  let apiKey = existingKey
  let sql    = null
  let insertedKeyId = null

  if (!apiKey) {
    log('No --key provided. Generating test key directly in Cloud SQL...')
    sql = postgres(DB_URL, { max: 1, idle_timeout: 10 })

    // Need a real user_id to satisfy FK — grab the first user
    const [user] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`
    if (!user) { err('No users in DB. Register first.'); process.exit(1) }
    log(`Using user_id: ${user.id}`)

    const { key, hash, prefix } = generateKey()
    const [row] = await sql`
      INSERT INTO api_keys (user_id, name, key_hash, key_prefix, scopes)
      VALUES (${user.id}, 'ws-connect-test', ${hash}, ${prefix}, ARRAY['read','write'])
      RETURNING id
    `
    insertedKeyId = row.id
    apiKey = key
    log(`Generated key: ${key.slice(0, 16)}... (prefix: ${prefix})`)
    log(`Stored hash (SHA-256): ${hash.slice(0, 16)}...`)
  }

  // ─── WebSocket test ─────────────────────────────────────────────────────────
  const wsEndpoint = `${WS_URL}/api/ws/agent?key=${apiKey}`
  log(`Connecting to: ${WS_URL}/api/ws/agent?key=${apiKey.slice(0, 16)}...`)

  await new Promise((resolve) => {
    const ws = new WebSocket(wsEndpoint, {
      headers: { 'User-Agent': 'SessionForge-Agent/0.1.0-test' },
      handshakeTimeout: 15000,
    })

    const timeout = setTimeout(() => {
      err('Connection timeout (15s)')
      ws.terminate()
      resolve('timeout')
    }, 15000)

    ws.on('open', () => {
      log('WebSocket CONNECTED ✓')
      clearTimeout(timeout)

      const registerMsg = JSON.stringify({
        type:      'register',
        machineId: 'test-machine-001',
        name:      'WS Connect Test',
        os:        'windows',
        hostname:  'DESKTOP-TEST',
        version:   '0.1.0-test',
      })
      log(`Sending register: ${registerMsg}`)
      ws.send(registerMsg)

      // Wait briefly for any response then close
      setTimeout(() => {
        log('Closing connection gracefully.')
        ws.close(1000, 'test complete')
        resolve('success')
      }, 3000)
    })

    ws.on('message', (data) => {
      log(`Received message: ${data}`)
    })

    ws.on('close', (code, reason) => {
      clearTimeout(timeout)
      log(`WebSocket closed: code=${code} reason=${reason.toString() || '(none)'}`)
      resolve('closed')
    })

    ws.on('error', (e) => {
      clearTimeout(timeout)
      const msg = e.message || String(e)
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        err(`401 Unauthorized — API key rejected. Deploy the server.js SHA-256 fix first.`)
      } else {
        err(`Connection error: ${msg}`)
      }
      resolve('error')
    })
  })

  // ─── Cleanup ────────────────────────────────────────────────────────────────
  if (sql && insertedKeyId) {
    await sql`DELETE FROM api_keys WHERE id = ${insertedKeyId}`
    log(`Cleaned up test key (id: ${insertedKeyId})`)
    await sql.end()
  }

  log('Done.')
}

main().catch((e) => { err(String(e)); process.exit(1) })
