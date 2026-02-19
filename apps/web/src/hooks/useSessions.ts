'use client'

import { useEffect, useState } from 'react'
import { useStore, type Session } from '@/store'

export function useSessions(machineId?: string) {
  const { sessions, setSessions } = useStore()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSessions() {
      setIsLoading(true)
      try {
        const url = machineId ? `/api/sessions?machineId=${machineId}` : '/api/sessions'
        const res = await fetch(url)
        if (!res.ok) throw new Error('Failed to load sessions')
        const json = await res.json()
        if (json.data?.items) {
          const sessions: Session[] = json.data.items.map((s: {
            id: string
            machineId: string
            pid: number | null
            processName: string | null
            workdir: string | null
            status: string
            exitCode: number | null
            peakMemoryMb: number | null
            avgCpuPercent: number | null
            startedAt: string | null
            stoppedAt: string | null
            createdAt: string
          }) => ({
            id: s.id,
            machineId: s.machineId,
            pid: s.pid,
            processName: s.processName ?? 'unknown',
            workdir: s.workdir,
            status: s.status,
            peakMemoryMb: s.peakMemoryMb,
            avgCpuPercent: s.avgCpuPercent,
            startedAt: s.startedAt ? new Date(s.startedAt) : new Date(s.createdAt),
            stoppedAt: s.stoppedAt ? new Date(s.stoppedAt) : null,
          }))
          setSessions(sessions)
        }
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
  const { sessions, addSession } = useStore()
  const session = sessions.find((s) => s.id === id)
  const [isLoading, setIsLoading] = useState(!session)

  useEffect(() => {
    if (session) {
      setIsLoading(false)
      return
    }
    // Not in store (direct navigation) — fetch individually
    async function fetchSession() {
      try {
        const res = await fetch(`/api/sessions/${id}`)
        if (!res.ok) return
        const json = await res.json()
        if (json.data) {
          const s = json.data
          addSession({
            id: s.id,
            machineId: s.machineId,
            pid: s.pid,
            processName: s.processName ?? 'unknown',
            workdir: s.workdir,
            status: s.status,
            peakMemoryMb: s.peakMemoryMb,
            avgCpuPercent: s.avgCpuPercent,
            startedAt: s.startedAt ? new Date(s.startedAt) : new Date(s.createdAt),
            stoppedAt: s.stoppedAt ? new Date(s.stoppedAt) : null,
          })
        }
      } finally {
        setIsLoading(false)
      }
    }
    fetchSession()
  }, [id, session, addSession])

  return { session, isLoading }
}
