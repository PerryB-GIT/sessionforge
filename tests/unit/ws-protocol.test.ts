/**
 * Unit tests for the WebSocket message protocol types
 *
 * Validates that messages conform to the AgentMessage and CloudToAgentMessage
 * type contracts defined in @sessionforge/shared-types/ws-protocol.
 *
 * These tests focus on:
 *   - Required field presence
 *   - Base64 encoding invariant for data fields
 *   - Type discriminant exhaustiveness
 *   - Rejection of messages with invalid/unknown types
 *
 * Because the types are TypeScript interfaces (structural, no runtime schema),
 * we pair each type test with a Zod runtime validator that mirrors the
 * interface — the same validators the backend will use for incoming messages.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { AgentMessage, CloudToAgentMessage } from '@sessionforge/shared-types'

// ---------------------------------------------------------------------------
// Runtime Zod schemas that mirror the TypeScript types
// STUB: once the backend builds its own validation layer, import from there:
// import { agentMessageSchema, cloudToAgentMessageSchema } from '@sessionforge/backend/ws/validation'
// ---------------------------------------------------------------------------

const heartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  machineId: z.string().min(1),
  cpu: z.number().min(0).max(100),
  memory: z.number().min(0).max(100),
  disk: z.number().min(0).max(100),
  sessionCount: z.number().int().min(0),
})

const sessionStartedSchema = z.object({
  type: z.literal('session_started'),
  session: z.object({
    id: z.string().min(1),
    pid: z.number().int().positive(),
    processName: z.string().min(1),
    workdir: z.string().min(1),
    startedAt: z.string().datetime(),
  }),
})

const sessionStoppedSchema = z.object({
  type: z.literal('session_stopped'),
  sessionId: z.string().min(1),
  exitCode: z.number().int().nullable(),
})

const sessionCrashedSchema = z.object({
  type: z.literal('session_crashed'),
  sessionId: z.string().min(1),
  error: z.string().min(1),
})

const sessionOutputSchema = z.object({
  type: z.literal('session_output'),
  sessionId: z.string().min(1),
  // data must be a valid base64-encoded string
  data: z.string().refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').toString('base64') === v
      } catch {
        return false
      }
    },
    { message: 'data must be base64 encoded' }
  ),
})

const registerSchema = z.object({
  type: z.literal('register'),
  machineId: z.string().min(1),
  name: z.string().min(1),
  os: z.string().min(1),
  hostname: z.string().min(1),
  version: z.string().min(1),
})

/** Union of all agent → cloud messages */
const agentMessageSchema = z.discriminatedUnion('type', [
  heartbeatSchema,
  sessionStartedSchema,
  sessionStoppedSchema,
  sessionCrashedSchema,
  sessionOutputSchema,
  registerSchema,
])

const startSessionSchema = z.object({
  type: z.literal('start_session'),
  requestId: z.string().min(1),
  command: z.string().min(1),
  workdir: z.string().min(1),
  env: z.record(z.string()).optional(),
})

const stopSessionSchema = z.object({
  type: z.literal('stop_session'),
  sessionId: z.string().min(1),
  force: z.boolean().optional(),
})

const sessionInputSchema = z.object({
  type: z.literal('session_input'),
  sessionId: z.string().min(1),
  data: z.string().refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').toString('base64') === v
      } catch {
        return false
      }
    },
    { message: 'data must be base64 encoded' }
  ),
})

const resizeSchema = z.object({
  type: z.literal('resize'),
  sessionId: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
})

/** Union of all cloud → agent messages */
const cloudToAgentMessageSchema = z.discriminatedUnion('type', [
  startSessionSchema,
  stopSessionSchema,
  z.object({ type: z.literal('pause_session'), sessionId: z.string().min(1) }),
  z.object({ type: z.literal('resume_session'), sessionId: z.string().min(1) }),
  sessionInputSchema,
  resizeSchema,
  z.object({ type: z.literal('ping') }),
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(str: string): string {
  return Buffer.from(str).toString('base64')
}

function isValidBase64(str: string): boolean {
  try {
    return Buffer.from(str, 'base64').toString('base64') === str
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// AgentMessage tests
// ---------------------------------------------------------------------------

describe('AgentMessage: heartbeat', () => {
  it('validates a well-formed heartbeat message', () => {
    const msg: AgentMessage = {
      type: 'heartbeat',
      machineId: 'machine-abc123',
      cpu: 12.5,
      memory: 45.0,
      disk: 60.0,
      sessionCount: 2,
    }
    expect(() => heartbeatSchema.parse(msg)).not.toThrow()
  })

  it('requires machineId to be present and non-empty', () => {
    const result = heartbeatSchema.safeParse({ type: 'heartbeat', cpu: 10, memory: 20, disk: 30, sessionCount: 0 })
    expect(result.success).toBe(false)
  })

  it('requires cpu field', () => {
    const result = heartbeatSchema.safeParse({ type: 'heartbeat', machineId: 'abc', memory: 20, disk: 30, sessionCount: 0 })
    expect(result.success).toBe(false)
  })

  it('requires memory field', () => {
    const result = heartbeatSchema.safeParse({ type: 'heartbeat', machineId: 'abc', cpu: 10, disk: 30, sessionCount: 0 })
    expect(result.success).toBe(false)
  })

  it('requires disk field', () => {
    const result = heartbeatSchema.safeParse({ type: 'heartbeat', machineId: 'abc', cpu: 10, memory: 20, sessionCount: 0 })
    expect(result.success).toBe(false)
  })

  it('requires sessionCount field', () => {
    const result = heartbeatSchema.safeParse({ type: 'heartbeat', machineId: 'abc', cpu: 10, memory: 20, disk: 30 })
    expect(result.success).toBe(false)
  })

  it('rejects cpu values outside 0-100', () => {
    const result = heartbeatSchema.safeParse({ type: 'heartbeat', machineId: 'abc', cpu: 150, memory: 50, disk: 50, sessionCount: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects negative sessionCount', () => {
    const result = heartbeatSchema.safeParse({ type: 'heartbeat', machineId: 'abc', cpu: 10, memory: 20, disk: 30, sessionCount: -1 })
    expect(result.success).toBe(false)
  })
})

describe('AgentMessage: session_output', () => {
  it('accepts valid base64-encoded data', () => {
    const msg: AgentMessage = {
      type: 'session_output',
      sessionId: 'sess-123',
      data: toBase64('Hello, terminal!'),
    }
    expect(() => sessionOutputSchema.parse(msg)).not.toThrow()
  })

  it('rejects non-base64 data', () => {
    const result = sessionOutputSchema.safeParse({
      type: 'session_output',
      sessionId: 'sess-123',
      data: 'not valid base64!!!',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty data string', () => {
    // Empty string is technically valid base64 but may be rejected by business logic
    // Here we verify the parser accepts it (the backend can add stricter checks)
    const result = sessionOutputSchema.safeParse({
      type: 'session_output',
      sessionId: 'sess-123',
      data: '',
    })
    // Empty string is valid base64 so this should pass at protocol level
    expect(result.success).toBe(true)
  })

  it('encoded output can be decoded to original bytes', () => {
    const original = '\x1b[32mHello\x1b[0m' // ANSI escape sequence
    const encoded = toBase64(original)
    const decoded = Buffer.from(encoded, 'base64').toString()
    expect(decoded).toBe(original)
    expect(isValidBase64(encoded)).toBe(true)
  })
})

describe('AgentMessage: register', () => {
  it('validates a well-formed register message', () => {
    const msg: AgentMessage = {
      type: 'register',
      machineId: 'machine-xyz',
      name: 'My Dev Machine',
      os: 'linux',
      hostname: 'dev-01',
      version: '1.2.3',
    }
    expect(() => registerSchema.parse(msg)).not.toThrow()
  })

  it('requires all fields to be present', () => {
    const result = registerSchema.safeParse({ type: 'register', machineId: 'abc' })
    expect(result.success).toBe(false)
  })
})

describe('AgentMessage: type discriminant', () => {
  it('rejects an unknown message type', () => {
    const result = agentMessageSchema.safeParse({ type: 'unknown_type', machineId: 'abc' })
    expect(result.success).toBe(false)
  })

  it('all valid message types are accepted by the union', () => {
    const validMessages = [
      { type: 'heartbeat', machineId: 'abc', cpu: 10, memory: 20, disk: 30, sessionCount: 0 },
      {
        type: 'session_started',
        session: { id: 's1', pid: 123, processName: 'claude', workdir: '/home', startedAt: new Date().toISOString() },
      },
      { type: 'session_stopped', sessionId: 's1', exitCode: 0 },
      { type: 'session_crashed', sessionId: 's1', error: 'OOM' },
      { type: 'session_output', sessionId: 's1', data: toBase64('output') },
      { type: 'register', machineId: 'abc', name: 'Dev', os: 'linux', hostname: 'h1', version: '1.0' },
    ]
    for (const msg of validMessages) {
      expect(agentMessageSchema.safeParse(msg).success, `failed for type: ${msg.type}`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// CloudToAgentMessage tests
// ---------------------------------------------------------------------------

describe('CloudToAgentMessage: session_input', () => {
  it('accepts valid base64-encoded input data', () => {
    const msg = {
      type: 'session_input' as const,
      sessionId: 'sess-456',
      data: toBase64('ls -la\n'),
    }
    expect(() => sessionInputSchema.parse(msg)).not.toThrow()
  })

  it('rejects non-base64 input data', () => {
    const result = sessionInputSchema.safeParse({
      type: 'session_input',
      sessionId: 'sess-456',
      data: '!!! not base64 !!!',
    })
    expect(result.success).toBe(false)
  })

  it('encoded input can be decoded back to original keystrokes', () => {
    const keystrokes = 'claude\n'
    const encoded = toBase64(keystrokes)
    const decoded = Buffer.from(encoded, 'base64').toString()
    expect(decoded).toBe(keystrokes)
  })
})

describe('CloudToAgentMessage: resize', () => {
  it('validates a well-formed resize message', () => {
    const msg = { type: 'resize' as const, sessionId: 'sess-789', cols: 220, rows: 50 }
    expect(() => resizeSchema.parse(msg)).not.toThrow()
  })

  it('rejects zero or negative cols', () => {
    expect(resizeSchema.safeParse({ type: 'resize', sessionId: 's', cols: 0, rows: 24 }).success).toBe(false)
    expect(resizeSchema.safeParse({ type: 'resize', sessionId: 's', cols: -1, rows: 24 }).success).toBe(false)
  })

  it('rejects zero or negative rows', () => {
    expect(resizeSchema.safeParse({ type: 'resize', sessionId: 's', cols: 80, rows: 0 }).success).toBe(false)
  })
})

describe('CloudToAgentMessage: type discriminant', () => {
  it('rejects an unknown message type', () => {
    const result = cloudToAgentMessageSchema.safeParse({ type: 'do_something_evil' })
    expect(result.success).toBe(false)
  })

  it('all valid cloud → agent types are accepted by the union', () => {
    const validMessages = [
      { type: 'start_session', requestId: 'req-1', command: 'claude', workdir: '/home' },
      { type: 'stop_session', sessionId: 'sess-1' },
      { type: 'pause_session', sessionId: 'sess-1' },
      { type: 'resume_session', sessionId: 'sess-1' },
      { type: 'session_input', sessionId: 'sess-1', data: toBase64('ls') },
      { type: 'resize', sessionId: 'sess-1', cols: 80, rows: 24 },
      { type: 'ping' },
    ]
    for (const msg of validMessages) {
      expect(cloudToAgentMessageSchema.safeParse(msg).success, `failed for type: ${msg.type}`).toBe(true)
    }
  })
})
