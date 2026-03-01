import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export type MachineStatus = 'online' | 'offline' | 'error'
export type SessionStatus = 'running' | 'stopped' | 'crashed' | 'paused'
export type PlanTier = 'free' | 'pro' | 'team' | 'enterprise'
export type WsStatus = 'connecting' | 'connected' | 'disconnected'

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
  // Metrics from heartbeats
  cpu?: number
  memory?: number
  disk?: number
  sessionCount?: number
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
  plan: PlanTier
  stripeCustomerId: string | null
  createdAt: Date
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  lastUsed: Date | null
  createdAt: Date
  scopes: string[]
}

interface SessionForgeStore {
  // Data
  machines: Machine[]
  sessions: Session[]
  apiKeys: ApiKey[]
  user: User | null
  wsStatus: WsStatus

  // Machine actions
  setMachines: (machines: Machine[]) => void
  updateMachine: (id: string, patch: Partial<Machine>) => void
  addMachine: (machine: Machine) => void
  removeMachine: (id: string) => void

  // Session actions
  setSessions: (sessions: Session[]) => void
  updateSession: (id: string, patch: Partial<Session>) => void
  addSession: (session: Session) => void

  // API Key actions
  setApiKeys: (keys: ApiKey[]) => void
  addApiKey: (key: ApiKey) => void
  removeApiKey: (id: string) => void

  // Auth actions
  setUser: (user: User | null) => void

  // WS actions
  setWsStatus: (status: WsStatus) => void
}

export const useStore = create<SessionForgeStore>()(
  devtools(
    (set) => ({
      machines: [],
      sessions: [],
      apiKeys: [],
      user: null,
      wsStatus: 'disconnected',

      setMachines: (machines) => set({ machines }),
      updateMachine: (id, patch) =>
        set((state) => ({
          machines: state.machines.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),
      addMachine: (machine) =>
        set((state) => ({ machines: [...state.machines, machine] })),
      removeMachine: (id) =>
        set((state) => ({ machines: state.machines.filter((m) => m.id !== id) })),

      setSessions: (sessions) => set({ sessions }),
      updateSession: (id, patch) =>
        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        })),
      addSession: (session) =>
        set((state) => ({ sessions: [...state.sessions, session] })),

      setApiKeys: (apiKeys) => set({ apiKeys }),
      addApiKey: (key) =>
        set((state) => ({ apiKeys: [...state.apiKeys, key] })),
      removeApiKey: (id) =>
        set((state) => ({ apiKeys: state.apiKeys.filter((k) => k.id !== id) })),

      setUser: (user) => set({ user }),
      setWsStatus: (wsStatus) => set({ wsStatus }),
    }),
    { name: 'SessionForge' }
  )
)
