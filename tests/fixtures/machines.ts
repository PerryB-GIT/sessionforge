import type { Machine, MachineStatus } from '@sessionforge/shared-types'

// ---------------------------------------------------------------------------
// Machine fixture shapes
// ---------------------------------------------------------------------------

export interface TestMachineInput {
  name: string
  os: 'windows' | 'macos' | 'linux'
  hostname: string
  version: string
}

export const linuxMachine: TestMachineInput = {
  name: 'Test Linux Machine',
  os: 'linux',
  hostname: 'test-linux-01',
  version: '1.0.0',
}

export const macosMachine: TestMachineInput = {
  name: 'Test macOS Machine',
  os: 'macos',
  hostname: 'test-mac-01',
  version: '1.0.0',
}

export const windowsMachine: TestMachineInput = {
  name: 'Test Windows Machine',
  os: 'windows',
  hostname: 'DESKTOP-TEST01',
  version: '1.0.0',
}

/**
 * Factory for generating unique machine fixtures.
 * Pass userId so integration tests can tie the machine to a seeded user.
 */
export function makeMachine(overrides: Partial<TestMachineInput> = {}): TestMachineInput {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  return {
    name: `Machine-${suffix}`,
    os: 'linux',
    hostname: `host-${suffix}`,
    version: '1.0.0',
    ...overrides,
  }
}

/**
 * Shape of a heartbeat payload as the agent sends it.
 */
export interface HeartbeatPayload {
  type: 'heartbeat'
  machineId: string
  cpu: number
  memory: number
  disk: number
  sessionCount: number
}

export function makeHeartbeat(machineId: string, overrides: Partial<Omit<HeartbeatPayload, 'type' | 'machineId'>> = {}): HeartbeatPayload {
  return {
    type: 'heartbeat',
    machineId,
    cpu: 12.5,
    memory: 45.0,
    disk: 60.0,
    sessionCount: 0,
    ...overrides,
  }
}

/**
 * Shape of a register payload as the agent sends it on first connect.
 */
export interface RegisterPayload {
  type: 'register'
  machineId: string
  name: string
  os: string
  hostname: string
  version: string
}

export function makeRegisterPayload(overrides: Partial<Omit<RegisterPayload, 'type'>> = {}): RegisterPayload {
  const suffix = Math.random().toString(36).slice(2, 7)
  return {
    type: 'register',
    machineId: `machine-${suffix}`,
    name: `Agent Machine ${suffix}`,
    os: 'linux',
    hostname: `host-${suffix}`,
    version: '1.0.0',
    ...overrides,
  }
}
