/**
 * Integration tests for the Machines API
 *
 * Tests the full HTTP request/response cycle for:
 *   GET    /api/machines
 *   POST   /api/machines
 *   GET    /api/machines/:id
 *   PATCH  /api/machines/:id
 *   DELETE /api/machines/:id
 *
 * Also tests that a machine appears in the list after its agent sends a
 * WebSocket 'register' message.
 *
 * STUB: Replace the stub HTTP client below with real supertest once the
 * Backend agent builds the API routes.
 * import request from 'supertest'
 * import { app } from '../../../apps/web/src/app'
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeAuthHeaders } from '../helpers/auth'
import { makeMachine, makeRegisterPayload } from '../fixtures/machines'
import { testUser } from '../fixtures/users'

// STUB: import when backend builds [API routes + WebSocket handler]
// import request from 'supertest'
// import { app } from '../../../apps/web/src/app'

// ---------------------------------------------------------------------------
// In-memory machine store (simulates DB state for stub tests)
// ---------------------------------------------------------------------------

interface StoredMachine {
  id: string
  userId: string
  name: string
  os: string
  hostname: string
  agentVersion: string
  status: 'online' | 'offline' | 'error'
  lastSeen: string | null
  createdAt: string
}

let machineStore: StoredMachine[] = []
let machineIdCounter = 1

function makeMachineRecord(userId: string, input: ReturnType<typeof makeMachine>): StoredMachine {
  return {
    id: `machine-stub-${machineIdCounter++}`,
    userId,
    name: input.name,
    os: input.os,
    hostname: input.hostname,
    agentVersion: input.version,
    status: 'offline',
    lastSeen: null,
    createdAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Stub HTTP client
// STUB: Replace with: const api = request(app)
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface StubResponse {
  status: number
  body: Record<string, unknown>
}

function stubRequest(
  method: HttpMethod,
  path: string,
  headers: Record<string, string> = {}
) {
  const isAuthed = headers['authorization']?.startsWith('Bearer ') ?? false
  const userId = 'stub-user-id' // all authed requests use this user

  return {
    send: async (body?: Record<string, unknown>): Promise<StubResponse> => {
      // --- Auth gate ---
      if (!isAuthed && path.startsWith('/api/machines')) {
        return { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } }
      }

      // GET /api/machines
      if (method === 'GET' && path === '/api/machines') {
        const userMachines = machineStore.filter((m) => m.userId === userId)
        return { status: 200, body: { data: userMachines } }
      }

      // POST /api/machines
      if (method === 'POST' && path === '/api/machines') {
        if (!body?.name) {
          return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'name is required' } } }
        }
        const machine = makeMachineRecord(userId, {
          name: body.name as string,
          os: (body.os as 'linux' | 'macos' | 'windows') ?? 'linux',
          hostname: (body.hostname as string) ?? 'unknown',
          version: (body.version as string) ?? '1.0.0',
        })
        machineStore.push(machine)
        return { status: 201, body: { data: machine } }
      }

      // GET /api/machines/:id
      const idMatch = path.match(/^\/api\/machines\/([^/]+)$/)
      if (idMatch) {
        const machineId = idMatch[1]
        const machine = machineStore.find((m) => m.id === machineId && m.userId === userId)

        if (method === 'GET') {
          if (!machine) return { status: 404, body: { error: { code: 'NOT_FOUND' } } }
          return { status: 200, body: { data: machine } }
        }

        if (method === 'PATCH') {
          if (!machine) return { status: 404, body: { error: { code: 'NOT_FOUND' } } }
          if (body?.name) machine.name = body.name as string
          if (body?.status) machine.status = body.status as StoredMachine['status']
          return { status: 200, body: { data: machine } }
        }

        if (method === 'DELETE') {
          const idx = machineStore.findIndex((m) => m.id === machineId && m.userId === userId)
          if (idx === -1) return { status: 404, body: { error: { code: 'NOT_FOUND' } } }
          machineStore.splice(idx, 1)
          return { status: 204, body: {} }
        }
      }

      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Route not found' } } }
    },
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let authHeaders: Record<string, string>

beforeEach(async () => {
  machineStore = [] // reset in-memory store
  machineIdCounter = 1
  authHeaders = await makeAuthHeaders('stub-user-id', 'free')
})

// ---------------------------------------------------------------------------
// GET /api/machines
// ---------------------------------------------------------------------------

describe('GET /api/machines', () => {
  it('returns 401 without authentication', async () => {
    const res = await stubRequest('GET', '/api/machines').send()
    expect(res.status).toBe(401)
  })

  it('returns 200 and an empty array when user has no machines', async () => {
    const res = await stubRequest('GET', '/api/machines', authHeaders).send()
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('returns 200 and a list of machines after machines are created', async () => {
    const m1 = makeMachine({ name: 'Machine A' })
    const m2 = makeMachine({ name: 'Machine B' })
    machineStore.push(makeMachineRecord('stub-user-id', m1))
    machineStore.push(makeMachineRecord('stub-user-id', m2))

    const res = await stubRequest('GET', '/api/machines', authHeaders).send()
    expect(res.status).toBe(200)
    expect((res.body.data as StoredMachine[]).length).toBe(2)
    expect((res.body.data as StoredMachine[]).map((m) => m.name)).toContain('Machine A')
    expect((res.body.data as StoredMachine[]).map((m) => m.name)).toContain('Machine B')
  })

  it('does not return machines belonging to other users', async () => {
    // Other user's machine
    machineStore.push({ ...makeMachineRecord('other-user-id', makeMachine()), id: 'other-machine-1' })
    // Own machine
    machineStore.push(makeMachineRecord('stub-user-id', makeMachine({ name: 'My Machine' })))

    const res = await stubRequest('GET', '/api/machines', authHeaders).send()
    expect(res.status).toBe(200)
    const machines = res.body.data as StoredMachine[]
    expect(machines.every((m) => m.userId === 'stub-user-id')).toBe(true)
    expect(machines.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// POST /api/machines
// ---------------------------------------------------------------------------

describe('POST /api/machines', () => {
  it('returns 401 without authentication', async () => {
    const res = await stubRequest('POST', '/api/machines').send({ name: 'Test' })
    expect(res.status).toBe(401)
  })

  it('returns 201 and the new machine with valid data', async () => {
    const input = makeMachine({ name: 'New Machine', os: 'linux' })
    const res = await stubRequest('POST', '/api/machines', authHeaders).send(input)
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ name: input.name, os: input.os })
  })

  it('returns 400 when name is missing', async () => {
    const res = await stubRequest('POST', '/api/machines', authHeaders).send({ os: 'linux' })
    expect(res.status).toBe(400)
  })

  it('new machine starts with status offline', async () => {
    const input = makeMachine()
    const res = await stubRequest('POST', '/api/machines', authHeaders).send(input)
    expect((res.body.data as StoredMachine).status).toBe('offline')
  })
})

// ---------------------------------------------------------------------------
// GET /api/machines/:id
// ---------------------------------------------------------------------------

describe('GET /api/machines/:id', () => {
  it('returns 404 for a non-existent machine', async () => {
    const res = await stubRequest('GET', '/api/machines/does-not-exist', authHeaders).send()
    expect(res.status).toBe(404)
  })

  it('returns 200 and the machine data for an existing machine', async () => {
    const machine = makeMachineRecord('stub-user-id', makeMachine({ name: 'Fetch Me' }))
    machineStore.push(machine)

    const res = await stubRequest('GET', `/api/machines/${machine.id}`, authHeaders).send()
    expect(res.status).toBe(200)
    expect((res.body.data as StoredMachine).name).toBe('Fetch Me')
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/machines/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/machines/:id', () => {
  it('returns 404 when patching a non-existent machine', async () => {
    const res = await stubRequest('PATCH', '/api/machines/ghost', authHeaders).send({ name: 'Ghost' })
    expect(res.status).toBe(404)
  })

  it('updates the machine name and returns 200', async () => {
    const machine = makeMachineRecord('stub-user-id', makeMachine({ name: 'Old Name' }))
    machineStore.push(machine)

    const res = await stubRequest('PATCH', `/api/machines/${machine.id}`, authHeaders).send({ name: 'New Name' })
    expect(res.status).toBe(200)
    expect((res.body.data as StoredMachine).name).toBe('New Name')
  })

  it('persists the name change so a subsequent GET reflects it', async () => {
    const machine = makeMachineRecord('stub-user-id', makeMachine({ name: 'Before' }))
    machineStore.push(machine)

    await stubRequest('PATCH', `/api/machines/${machine.id}`, authHeaders).send({ name: 'After' })

    const getRes = await stubRequest('GET', `/api/machines/${machine.id}`, authHeaders).send()
    expect((getRes.body.data as StoredMachine).name).toBe('After')
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/machines/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/machines/:id', () => {
  it('returns 404 when deleting a non-existent machine', async () => {
    const res = await stubRequest('DELETE', '/api/machines/ghost', authHeaders).send()
    expect(res.status).toBe(404)
  })

  it('returns 204 on successful deletion', async () => {
    const machine = makeMachineRecord('stub-user-id', makeMachine())
    machineStore.push(machine)

    const res = await stubRequest('DELETE', `/api/machines/${machine.id}`, authHeaders).send()
    expect(res.status).toBe(204)
  })

  it('subsequent GET returns 404 after deletion', async () => {
    const machine = makeMachineRecord('stub-user-id', makeMachine())
    machineStore.push(machine)

    await stubRequest('DELETE', `/api/machines/${machine.id}`, authHeaders).send()
    const res = await stubRequest('GET', `/api/machines/${machine.id}`, authHeaders).send()
    expect(res.status).toBe(404)
  })

  it('machine no longer appears in the list after deletion', async () => {
    const machine = makeMachineRecord('stub-user-id', makeMachine({ name: 'To Delete' }))
    machineStore.push(machine)

    await stubRequest('DELETE', `/api/machines/${machine.id}`, authHeaders).send()

    const listRes = await stubRequest('GET', '/api/machines', authHeaders).send()
    const names = (listRes.body.data as StoredMachine[]).map((m) => m.name)
    expect(names).not.toContain('To Delete')
  })
})

// ---------------------------------------------------------------------------
// Machine appears in list after WebSocket register message
// ---------------------------------------------------------------------------

describe('Machine registration via WebSocket', () => {
  it('machine appears in the list after the agent sends a register message', async () => {
    /**
     * STUB: This test will be expanded once the WebSocket handler is built by
     * the Backend agent.  The full flow is:
     *   1. Agent opens WSS connection with a valid API key
     *   2. Agent sends { type: 'register', machineId, name, os, hostname, version }
     *   3. Server creates / upserts a machine record in the DB
     *   4. GET /api/machines returns that machine
     *
     * For now we simulate step 3 manually and assert step 4.
     */

    // Simulate: agent sent a register payload → backend persists the machine
    const payload = makeRegisterPayload({ name: 'WS Registered Machine', os: 'linux' })
    const machine = makeMachineRecord('stub-user-id', {
      name: payload.name,
      os: payload.os,
      hostname: payload.hostname,
      version: payload.version,
    })
    machine.status = 'online' // register implies online
    machineStore.push(machine)

    // Assert the machine now shows up via the REST API
    const listRes = await stubRequest('GET', '/api/machines', authHeaders).send()
    expect(listRes.status).toBe(200)
    const names = (listRes.body.data as StoredMachine[]).map((m) => m.name)
    expect(names).toContain('WS Registered Machine')
  })
})
