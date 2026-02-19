import type { Session, SessionStatus } from '@sessionforge/shared-types'

// ---------------------------------------------------------------------------
// Session fixture shapes
// ---------------------------------------------------------------------------

export interface TestSessionInput {
  machineId: string
  command: string
  workdir: string
  env?: Record<string, string>
}

/**
 * Default session that runs claude in the home directory.
 */
export function makeSessionInput(machineId: string, overrides: Partial<TestSessionInput> = {}): TestSessionInput {
  return {
    machineId,
    command: 'claude',
    workdir: '/home/user',
    env: {},
    ...overrides,
  }
}

/**
 * Shape of a session_started message the agent sends back to cloud.
 */
export interface SessionStartedPayload {
  type: 'session_started'
  session: {
    id: string
    pid: number
    processName: string
    workdir: string
    startedAt: string
  }
}

export function makeSessionStarted(sessionId: string, overrides: Partial<SessionStartedPayload['session']> = {}): SessionStartedPayload {
  return {
    type: 'session_started',
    session: {
      id: sessionId,
      pid: 12345,
      processName: 'claude',
      workdir: '/home/user',
      startedAt: new Date().toISOString(),
      ...overrides,
    },
  }
}

/**
 * Shape of a session_stopped message the agent sends back to cloud.
 */
export interface SessionStoppedPayload {
  type: 'session_stopped'
  sessionId: string
  exitCode: number | null
}

export function makeSessionStopped(sessionId: string, exitCode: number | null = 0): SessionStoppedPayload {
  return {
    type: 'session_stopped',
    sessionId,
    exitCode,
  }
}

/**
 * Shape of a session_output message the agent sends back to cloud.
 * data must be base64-encoded PTY output.
 */
export interface SessionOutputPayload {
  type: 'session_output'
  sessionId: string
  data: string
}

export function makeSessionOutput(sessionId: string, rawOutput: string): SessionOutputPayload {
  return {
    type: 'session_output',
    sessionId,
    data: Buffer.from(rawOutput).toString('base64'),
  }
}

/**
 * Shape of a session_input message the cloud sends to the agent.
 * data must be base64-encoded input bytes.
 */
export interface SessionInputPayload {
  type: 'session_input'
  sessionId: string
  data: string
}

export function makeSessionInput2(sessionId: string, rawInput: string): SessionInputPayload {
  return {
    type: 'session_input',
    sessionId,
    data: Buffer.from(rawInput).toString('base64'),
  }
}

/** Minimal session object for assertion helpers */
export const defaultSession: Omit<Session, 'id' | 'machineId'> = {
  pid: null,
  processName: 'claude',
  workdir: '/home/user',
  startedAt: new Date(),
  stoppedAt: null,
  status: 'running',
  peakMemoryMb: null,
  avgCpuPercent: null,
}
