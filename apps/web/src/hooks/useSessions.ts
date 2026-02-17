'use client'

import { useEffect, useState } from 'react'
import { useStore, type Session } from '@/store'

// STUB: Mock data for development — replace with tRPC or fetch to /api/sessions
const MOCK_SESSIONS: Session[] = [
  {
    id: 'ses_01abc',
    machineId: 'mch_01',
    pid: 12345,
    processName: 'claude',
    workdir: '/Users/perry/projects/sessionforge',
    startedAt: new Date(Date.now() - 7200000),
    stoppedAt: null,
    status: 'running',
    peakMemoryMb: 512,
    avgCpuPercent: 28,
  },
  {
    id: 'ses_02def',
    machineId: 'mch_02',
    pid: 23456,
    processName: 'claude',
    workdir: '/home/perry/api-server',
    startedAt: new Date(Date.now() - 3600000),
    stoppedAt: null,
    status: 'running',
    peakMemoryMb: 768,
    avgCpuPercent: 45,
  },
  {
    id: 'ses_03ghi',
    machineId: 'mch_02',
    pid: 34567,
    processName: 'claude',
    workdir: '/home/perry/data-pipeline',
    startedAt: new Date(Date.now() - 1800000),
    stoppedAt: new Date(Date.now() - 900000),
    status: 'stopped',
    peakMemoryMb: 256,
    avgCpuPercent: 12,
  },
  {
    id: 'ses_04jkl',
    machineId: 'mch_01',
    pid: 45678,
    processName: 'node',
    workdir: '/Users/perry/projects/frontend',
    startedAt: new Date(Date.now() - 600000),
    stoppedAt: new Date(Date.now() - 60000),
    status: 'crashed',
    peakMemoryMb: 1024,
    avgCpuPercent: 89,
  },
]

export function useSessions(machineId?: string) {
  const { sessions, setSessions } = useStore()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSessions() {
      setIsLoading(true)
      try {
        // STUB: Replace with tRPC call: trpc.sessions.list.query({ machineId })
        // const url = machineId ? `/api/sessions?machineId=${machineId}` : '/api/sessions'
        // const res = await fetch(url)
        // const data = await res.json()
        await new Promise((resolve) => setTimeout(resolve, 300))
        setSessions(MOCK_SESSIONS)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions')
      } finally {
        setIsLoading(false)
      }
    }

    fetchSessions()
  }, [setSessions, machineId])

  const filtered = machineId ? sessions.filter((s) => s.machineId === machineId) : sessions

  return { sessions: filtered, isLoading, error }
}

export function useSession(id: string) {
  const sessions = useStore((s) => s.sessions)
  const session = sessions.find((s) => s.id === id)
  const [isLoading, setIsLoading] = useState(!session)

  useEffect(() => {
    if (!session) {
      setIsLoading(false)
    }
  }, [session])

  return { session, isLoading }
}
