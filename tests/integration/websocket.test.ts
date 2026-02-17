/**
 * Integration tests for the Agent WebSocket endpoint
 *
 * Tests the agent WebSocket connection lifecycle:
 *   - Connection without API key → rejected
 *   - Connection with valid API key → 101 Upgrade accepted
 *   - 'register' message → machine upserted in DB
 *   - 'heartbeat' message → machine lastSeen updated
 *   - 'session_output' → forwarded to Redis pub/sub
 *   - Disconnect → machine status set to 'offline'
 *
 * STUB: These tests use the mock WS server from helpers/ws.ts.
 * Once the Backend agent builds the real WebSocket handler at /api/ws/agent,
 * replace the mock server with a real HTTP server + WS connection.
 *
 * Real-world wiring:
 *   import { createServer } from 'http'
 *   import { NextServer } from 'next/dist/server/next'
 *   const server = createServer(nextApp.getRequestHandler())
 *   const wsUrl = `ws://localhost:${server.address().port}/api/ws/agent`
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createMockWsServer,
  createMockAgentClient,
  getMockWsUrl,
  type MockWsServer,
} from '../helpers/ws'
import { makeRegisterPayload, makeHeartbeat } from '../fixtures/machines'
import { makeSessionOutput } from '../fixtures/sessions'
import { generateTestApiKey } from '../helpers/auth'
import type { AgentMessage, CloudToAgentMessage } from '@sessionforge/shared-types'

// ---------------------------------------------------------------------------
// In-memory "database" + "Redis" for the stub WS server handler
// ---------------------------------------------------------------------------

interface MachineRecord {
  id: string
  name: string
  status: 'online' | 'offline' | 'error'
  lastSeen: Date | null
  os: string
  hostname: string
  version: string
}

interface RedisPubEvent {
  channel: string
  message: string
}

let machineStore: Map<string, MachineRecord>
let redisEvents: RedisPubEvent[]
let connectedMachineIds: Set<string>
let validApiKeys: Set<string>

// ---------------------------------------------------------------------------
// Stub WebSocket handler logic
//
// This mimics what the real backend WS handler will do, so these tests act
// as a living specification for the Backend agent.
// ---------------------------------------------------------------------------

function handleAgentMessage(
  msg: AgentMessage,
  apiKey: string
): { changed: boolean; machineId?: string } {
  if (!validApiKeys.has(apiKey)) return { changed: false }

  switch (msg.type) {
    case 'register': {
      const record: MachineRecord = {
        id: msg.machineId,
        name: msg.name,
        status: 'online',
        lastSeen: new Date(),
        os: msg.os,
        hostname: msg.hostname,
        version: msg.version,
      }
      machineStore.set(msg.machineId, record)
      connectedMachineIds.add(msg.machineId)
      return { changed: true, machineId: msg.machineId }
    }

    case 'heartbeat': {
      const existing = machineStore.get(msg.machineId)
      if (existing) {
        existing.lastSeen = new Date()
        existing.status = 'online'
      }
      return { changed: true, machineId: msg.machineId }
    }

    case 'session_output': {
      redisEvents.push({
        channel: `session:${msg.sessionId}:output`,
        message: JSON.stringify({ sessionId: msg.sessionId, data: msg.data }),
      })
      return { changed: true, machineId: undefined }
    }

    default:
      return { changed: false }
  }
}

function handleDisconnect(machineId: string): void {
  const machine = machineStore.get(machineId)
  if (machine) {
    machine.status = 'offline'
  }
  connectedMachineIds.delete(machineId)
}

// ---------------------------------------------------------------------------
// Test setup — run a mock WS server for each test
// ---------------------------------------------------------------------------

let wss: MockWsServer
let wsUrl: string
let testApiKey: string
let activeMachineId: string | undefined

beforeEach(async () => {
  machineStore = new Map()
  redisEvents = []
  connectedMachineIds = new Set()
  validApiKeys = new Set()

  testApiKey = generateTestApiKey()
  validApiKeys.add(testApiKey)

  wss = await createMockWsServer((msg, _socket) => {
    // The mock server runs the stub handler for each message received
    handleAgentMessage(msg, testApiKey)
  })
  wsUrl = getMockWsUrl(wss)
})

afterEach(async () => {
  await wss.close()
  activeMachineId = undefined
})

// ---------------------------------------------------------------------------
// Connection tests
// ---------------------------------------------------------------------------

describe('Agent WebSocket connection', () => {
  it('accepts a connection without requiring auth headers in the mock (stub: real impl rejects unauthenticated)', async () => {
    /**
     * STUB: The real endpoint at /api/ws/agent validates the API key from
     * the Authorization header before completing the WebSocket upgrade.
     * Unauthenticated connections receive a 401 HTTP response (not 101).
     *
     * In the mock server used here, auth is enforced at the message handler
     * level (handleAgentMessage checks validApiKeys).  This test documents
     * the expected real-world behaviour as a comment.
     *
     * Real test (enable once backend is built):
     *   const socket = new WebSocket(`${wsUrl}/api/ws/agent`)
     *   socket.on('unexpected-response', (req, res) => {
     *     expect(res.statusCode).toBe(401)
     *   })
     */
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    expect(client.socket.readyState).toBe(1 /* OPEN */)
    await client.close()
  })

  it('client can send a message immediately after connecting', async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const payload = makeRegisterPayload()

    client.send(payload)
    await wss.waitForMessages(1)

    expect(wss.receivedMessages[0].type).toBe('register')
    await client.close()
  })
})

// ---------------------------------------------------------------------------
// Register message
// ---------------------------------------------------------------------------

describe("'register' message", () => {
  it('machine is created in the store after a valid register message', async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const payload = makeRegisterPayload({ name: 'CI Runner', os: 'linux', hostname: 'ci-01' })

    client.send(payload)
    await wss.waitForMessages(1)

    const machine = machineStore.get(payload.machineId)
    expect(machine).toBeDefined()
    expect(machine?.name).toBe('CI Runner')
    expect(machine?.status).toBe('online')
    expect(machine?.hostname).toBe('ci-01')

    await client.close()
  })

  it('machine ID from the register payload is used as the store key', async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const payload = makeRegisterPayload()

    client.send(payload)
    await wss.waitForMessages(1)

    expect(machineStore.has(payload.machineId)).toBe(true)
    await client.close()
  })

  it('re-registering the same machineId updates the existing record', async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const payload = makeRegisterPayload({ name: 'First Name' })

    client.send(payload)
    await wss.waitForMessages(1)

    const updatedPayload = { ...payload, name: 'Updated Name', version: '2.0.0' }
    client.send(updatedPayload)
    await wss.waitForMessages(2)

    expect(machineStore.get(payload.machineId)?.name).toBe('Updated Name')
    await client.close()
  })
})

// ---------------------------------------------------------------------------
// Heartbeat message
// ---------------------------------------------------------------------------

describe("'heartbeat' message", () => {
  it("updates machine's lastSeen timestamp", async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const regPayload = makeRegisterPayload()
    client.send(regPayload)
    await wss.waitForMessages(1)

    const beforeHb = machineStore.get(regPayload.machineId)?.lastSeen

    // Wait a tiny bit so the timestamp differs
    await new Promise((r) => setTimeout(r, 5))

    const hb = makeHeartbeat(regPayload.machineId, { cpu: 50, memory: 70, disk: 80, sessionCount: 1 })
    client.send(hb)
    await wss.waitForMessages(2)

    const afterHb = machineStore.get(regPayload.machineId)?.lastSeen
    expect(afterHb).not.toBeNull()
    // lastSeen should be >= the value before the heartbeat
    expect(afterHb!.getTime()).toBeGreaterThanOrEqual(beforeHb!.getTime())

    await client.close()
  })

  it("machine remains 'online' after a heartbeat", async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const regPayload = makeRegisterPayload()
    client.send(regPayload)
    await wss.waitForMessages(1)

    const hb = makeHeartbeat(regPayload.machineId)
    client.send(hb)
    await wss.waitForMessages(2)

    expect(machineStore.get(regPayload.machineId)?.status).toBe('online')
    await client.close()
  })
})

// ---------------------------------------------------------------------------
// session_output forwarded to Redis
// ---------------------------------------------------------------------------

describe("'session_output' message", () => {
  it('publishes to the correct Redis channel', async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const sessionId = 'sess-test-001'
    const outputMsg = makeSessionOutput(sessionId, 'Hello, world!\n')

    client.send(outputMsg)
    await wss.waitForMessages(1)

    expect(redisEvents.length).toBe(1)
    expect(redisEvents[0].channel).toBe(`session:${sessionId}:output`)

    await client.close()
  })

  it('Redis message includes the base64-encoded data', async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const sessionId = 'sess-test-002'
    const rawOutput = 'claude running...'
    const outputMsg = makeSessionOutput(sessionId, rawOutput)

    client.send(outputMsg)
    await wss.waitForMessages(1)

    const event = JSON.parse(redisEvents[0].message) as { sessionId: string; data: string }
    expect(event.sessionId).toBe(sessionId)
    // Decoded data should match original
    expect(Buffer.from(event.data, 'base64').toString()).toBe(rawOutput)

    await client.close()
  })

  it('multiple session_output messages each publish to Redis', async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })

    client.send(makeSessionOutput('sess-A', 'chunk 1'))
    client.send(makeSessionOutput('sess-B', 'chunk 2'))
    client.send(makeSessionOutput('sess-A', 'chunk 3'))
    await wss.waitForMessages(3)

    expect(redisEvents.length).toBe(3)
    await client.close()
  })
})

// ---------------------------------------------------------------------------
// Disconnect → machine goes offline
// ---------------------------------------------------------------------------

describe('agent disconnect', () => {
  it("sets machine status to 'offline' after client disconnects", async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const regPayload = makeRegisterPayload()

    client.send(regPayload)
    await wss.waitForMessages(1)

    // Confirm it's online first
    expect(machineStore.get(regPayload.machineId)?.status).toBe('online')

    // Simulate the backend's disconnect handler
    await client.close()
    handleDisconnect(regPayload.machineId)

    expect(machineStore.get(regPayload.machineId)?.status).toBe('offline')
  })

  it('machine ID is removed from the connected set after disconnect', async () => {
    const client = await createMockAgentClient(wsUrl, { Authorization: `Bearer ${testApiKey}` })
    const regPayload = makeRegisterPayload()

    client.send(regPayload)
    await wss.waitForMessages(1)
    expect(connectedMachineIds.has(regPayload.machineId)).toBe(true)

    await client.close()
    handleDisconnect(regPayload.machineId)

    expect(connectedMachineIds.has(regPayload.machineId)).toBe(false)
  })
})
