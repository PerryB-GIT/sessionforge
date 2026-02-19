/**
 * Integration tests for the Sessions API
 *
 * Tests the full HTTP request/response cycle for:
 *   GET    /api/sessions
 *   POST   /api/sessions         (start a session on a machine)
 *   GET    /api/sessions/:id
 *   POST   /api/sessions/:id/stop
 *   DELETE /api/sessions/:id
 *
 * STUB: Replace the stub HTTP client with real supertest once the
 * Backend agent builds the API routes.
 * import request from 'supertest'
 * import { app } from '../../../apps/web/src/app'
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { makeAuthHeaders } from '../helpers/auth'
import { makeSessionInput } from '../fixtures/sessions'
import { makeMachine } from '../fixtures/machines'
import type { Session, SessionStatus } from '@sessionforge/shared-types'

// STUB: import when backend builds [API routes]

// ---------------------------------------------------------------------------
// In-memory session + machine store (simulates DB state for stub tests)
// ---------------------------------------------------------------------------

interface StoredSession {
  id: string
  machineId: string
  command: string
  workdir: string
  status: SessionStatus
  pid: number | null
  processName: string
  startedAt: string
  stoppedAt: string | null
  peakMemoryMb: number | null
  avgCpuPercent: number | null
}

interface StoredMachine {
  id: string
  userId: string
  name: string
  status: 'online' | 'offline' | 'error'
}

let sessionStore: StoredSession[] = []
let machineStore: StoredMachine[] = []
let sessionCounter = 1
let machineCounter = 1

function makeMachineRecord(userId: string, name: string): StoredMachine {
  return { id: `machine-${machineCounter++}`, userId, name, status: 'online' }
}

function makeSessionRecord(machineId: string, input: ReturnType<typeof makeSessionInput>): StoredSession {
  return {
    id: `session-${sessionCounter++}`,
    machineId,
    command: input.command,
    workdir: input.workdir,
    status: 'running',
    pid: Math.floor(Math.random() * 30000) + 1000,
    processName: input.command,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    peakMemoryMb: null,
    avgCpuPercent: null,
  }
}

// ---------------------------------------------------------------------------
// Stub HTTP client
// STUB: Replace with: const api = request(app)
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'DELETE'

interface StubResponse {
  status: number
  body: Record<string, unknown>
}

function stubRequest(method: HttpMethod, path: string, headers: Record<string, string> = {}) {
  const isAuthed = headers['authorization']?.startsWith('Bearer ') ?? false
  const userId = 'stub-user-id'

  return {
    send: async (body?: Record<string, unknown>): Promise<StubResponse> => {
      if (!isAuthed && path.startsWith('/api/sessions')) {
        return { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } }
      }

      // GET /api/sessions
      if (method === 'GET' && path === '/api/sessions') {
        const userMachineIds = machineStore
          .filter((m) => m.userId === userId)
          .map((m) => m.id)
        const userSessions = sessionStore.filter((s) => userMachineIds.includes(s.machineId))
        return { status: 200, body: { data: userSessions } }
      }

      // POST /api/sessions
      if (method === 'POST' && path === '/api/sessions') {
        if (!body?.machineId) {
          return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'machineId is required' } } }
        }
        const machine = machineStore.find((m) => m.id === body.machineId && m.userId === userId)
        if (!machine) {
          return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Machine not found' } } }
        }
        if (machine.status !== 'online') {
          return { status: 409, body: { error: { code: 'MACHINE_OFFLINE', message: 'Machine is not online' } } }
        }
        const session = makeSessionRecord(machine.id, {
          machineId: machine.id,
          command: (body.command as string) ?? 'claude',
          workdir: (body.workdir as string) ?? '/home/user',
        })
        sessionStore.push(session)
        return { status: 201, body: { data: session } }
      }

      // Match session-specific routes
      const idMatch = path.match(/^\/api\/sessions\/([^/]+)(\/stop)?$/)
      if (idMatch) {
        const sessionId = idMatch[1]
        const isStop = Boolean(idMatch[2])
        const session = sessionStore.find((s) => s.id === sessionId)
        const userMachineIds = machineStore.filter((m) => m.userId === userId).map((m) => m.id)
        const isOwner = session && userMachineIds.includes(session.machineId)

        if (!session || !isOwner) {
          return { status: 404, body: { error: { code: 'NOT_FOUND' } } }
        }

        // GET /api/sessions/:id
        if (method === 'GET' && !isStop) {
          return { status: 200, body: { data: session } }
        }

        // POST /api/sessions/:id/stop
        if (method === 'POST' && isStop) {
          if (session.status !== 'running') {
            return { status: 409, body: { error: { code: 'SESSION_NOT_RUNNING' } } }
          }
          session.status = 'stopped'
          session.stoppedAt = new Date().toISOString()
          return { status: 200, body: { data: session } }
        }

        // DELETE /api/sessions/:id
        if (method === 'DELETE') {
          const idx = sessionStore.indexOf(session)
          sessionStore.splice(idx, 1)
          return { status: 204, body: {} }
        }
      }

      return { status: 404, body: { error: { code: 'NOT_FOUND' } } }
    },
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let authHeaders: Record<string, string>
let testMachineId: string

beforeEach(async () => {
  sessionStore = []
  machineStore = []
  sessionCounter = 1
  machineCounter = 1
  authHeaders = await makeAuthHeaders('stub-user-id', 'free')

  // Seed a test machine so session tests have something to work with
  const machine = makeMachineRecord('stub-user-id', 'Test Machine')
  machineStore.push(machine)
  testMachineId = machine.id
})

// ---------------------------------------------------------------------------
// GET /api/sessions
// ---------------------------------------------------------------------------

describe('GET /api/sessions', () => {
  it('returns 401 without authentication', async () => {
    const res = await stubRequest('GET', '/api/sessions').send()
    expect(res.status).toBe(401)
  })

  it('returns 200 and an empty list when no sessions exist', async () => {
    const res = await stubRequest('GET', '/api/sessions', authHeaders).send()
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('returns all sessions for the authenticated user', async () => {
    sessionStore.push(makeSessionRecord(testMachineId, makeSessionInput(testMachineId)))
    sessionStore.push(makeSessionRecord(testMachineId, makeSessionInput(testMachineId)))

    const res = await stubRequest('GET', '/api/sessions', authHeaders).send()
    expect(res.status).toBe(200)
    expect((res.body.data as StoredSession[]).length).toBe(2)
  })

  it('does not return sessions belonging to other users', async () => {
    // Other user's machine + session
    const otherMachine = makeMachineRecord('other-user', 'Other Machine')
    machineStore.push(otherMachine)
    sessionStore.push(makeSessionRecord(otherMachine.id, makeSessionInput(otherMachine.id)))

    // Own session
    sessionStore.push(makeSessionRecord(testMachineId, makeSessionInput(testMachineId)))

    const res = await stubRequest('GET', '/api/sessions', authHeaders).send()
    expect(res.status).toBe(200)
    const sessions = res.body.data as StoredSession[]
    expect(sessions.length).toBe(1)
    expect(sessions[0].machineId).toBe(testMachineId)
  })
})

// ---------------------------------------------------------------------------
// POST /api/sessions (start session)
// ---------------------------------------------------------------------------

describe('POST /api/sessions', () => {
  it('returns 401 without authentication', async () => {
    const res = await stubRequest('POST', '/api/sessions').send({ machineId: testMachineId })
    expect(res.status).toBe(401)
  })

  it('returns 400 when machineId is missing', async () => {
    const res = await stubRequest('POST', '/api/sessions', authHeaders).send({ command: 'claude' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the machine does not exist', async () => {
    const res = await stubRequest('POST', '/api/sessions', authHeaders).send({ machineId: 'ghost' })
    expect(res.status).toBe(404)
  })

  it('returns 409 when the machine is offline', async () => {
    machineStore[0].status = 'offline'
    const res = await stubRequest('POST', '/api/sessions', authHeaders).send({ machineId: testMachineId })
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('MACHINE_OFFLINE')
  })

  it('returns 201 and the new session for a valid request', async () => {
    const res = await stubRequest('POST', '/api/sessions', authHeaders).send({
      machineId: testMachineId,
      command: 'claude',
      workdir: '/home/user',
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      machineId: testMachineId,
      command: 'claude',
      status: 'running',
    })
  })

  it('defaults to "claude" when no command is specified', async () => {
    const res = await stubRequest('POST', '/api/sessions', authHeaders).send({ machineId: testMachineId })
    expect(res.status).toBe(201)
    expect((res.body.data as StoredSession).processName).toBe('claude')
  })

  it('new session starts with status running', async () => {
    const res = await stubRequest('POST', '/api/sessions', authHeaders).send({ machineId: testMachineId })
    expect((res.body.data as StoredSession).status).toBe('running')
  })
})

// ---------------------------------------------------------------------------
// GET /api/sessions/:id
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id', () => {
  it('returns 404 for a non-existent session', async () => {
    const res = await stubRequest('GET', '/api/sessions/ghost', authHeaders).send()
    expect(res.status).toBe(404)
  })

  it('returns 200 and the session data for an existing session', async () => {
    const session = makeSessionRecord(testMachineId, makeSessionInput(testMachineId))
    sessionStore.push(session)

    const res = await stubRequest('GET', `/api/sessions/${session.id}`, authHeaders).send()
    expect(res.status).toBe(200)
    expect((res.body.data as StoredSession).id).toBe(session.id)
  })
})

// ---------------------------------------------------------------------------
// POST /api/sessions/:id/stop
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/stop', () => {
  it('returns 404 for a non-existent session', async () => {
    const res = await stubRequest('POST', '/api/sessions/ghost/stop', authHeaders).send()
    expect(res.status).toBe(404)
  })

  it('returns 200 and sets status to stopped', async () => {
    const session = makeSessionRecord(testMachineId, makeSessionInput(testMachineId))
    sessionStore.push(session)

    const res = await stubRequest('POST', `/api/sessions/${session.id}/stop`, authHeaders).send()
    expect(res.status).toBe(200)
    expect((res.body.data as StoredSession).status).toBe('stopped')
    expect((res.body.data as StoredSession).stoppedAt).not.toBeNull()
  })

  it('returns 409 when the session is already stopped', async () => {
    const session = makeSessionRecord(testMachineId, makeSessionInput(testMachineId))
    session.status = 'stopped'
    sessionStore.push(session)

    const res = await stubRequest('POST', `/api/sessions/${session.id}/stop`, authHeaders).send()
    expect(res.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/sessions/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/sessions/:id', () => {
  it('returns 404 for a non-existent session', async () => {
    const res = await stubRequest('DELETE', '/api/sessions/ghost', authHeaders).send()
    expect(res.status).toBe(404)
  })

  it('returns 204 on successful deletion', async () => {
    const session = makeSessionRecord(testMachineId, makeSessionInput(testMachineId))
    sessionStore.push(session)

    const res = await stubRequest('DELETE', `/api/sessions/${session.id}`, authHeaders).send()
    expect(res.status).toBe(204)
  })

  it('session no longer appears in list after deletion', async () => {
    const session = makeSessionRecord(testMachineId, makeSessionInput(testMachineId))
    sessionStore.push(session)

    await stubRequest('DELETE', `/api/sessions/${session.id}`, authHeaders).send()

    const listRes = await stubRequest('GET', '/api/sessions', authHeaders).send()
    expect((listRes.body.data as StoredSession[]).find((s) => s.id === session.id)).toBeUndefined()
  })
})
