export type MachineStatus = 'online' | 'offline' | 'error'
export type SessionStatus = 'running' | 'stopped' | 'crashed' | 'paused'
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface Machine {
  id: string
  userId: string
  orgId: string | null
  name: string
  os: 'windows' | 'macos' | 'linux'
  hostname: string
  status: MachineStatus
  lastSeen: Date | null
  createdAt: Date
}

export interface Session {
  id: string
  machineId: string
  pid: number | null
  processName: string
  workdir: string | null
  startedAt: Date
  stoppedAt: Date | null
  status: SessionStatus
  peakMemoryMb: number | null
  avgCpuPercent: number | null
}

export interface User {
  id: string
  email: string
  name: string | null
  plan: string
  stripeCustomerId: string | null
  createdAt: Date
}

export interface Organization {
  id: string
  name: string
  slug: string
  ownerId: string
  plan: string
  stripeSubscriptionId: string | null
  createdAt: Date
}
