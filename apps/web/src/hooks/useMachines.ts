'use client'

import { useEffect, useState } from 'react'
import { useStore, type Machine } from '@/store'

// STUB: Mock data for development — replace with tRPC or fetch to /api/machines
const MOCK_MACHINES: Machine[] = [
  {
    id: 'mch_01',
    userId: 'usr_01',
    orgId: null,
    name: 'MacBook Pro M3',
    os: 'macos',
    hostname: 'perrys-macbook.local',
    status: 'online',
    lastSeen: new Date(),
    createdAt: new Date('2024-01-15'),
    cpu: 34,
    memory: 62,
    disk: 48,
    sessionCount: 2,
  },
  {
    id: 'mch_02',
    userId: 'usr_01',
    orgId: null,
    name: 'Dev Server (Ubuntu)',
    os: 'linux',
    hostname: 'dev-server-01.internal',
    status: 'online',
    lastSeen: new Date(Date.now() - 30000),
    createdAt: new Date('2024-01-20'),
    cpu: 78,
    memory: 85,
    disk: 60,
    sessionCount: 5,
  },
  {
    id: 'mch_03',
    userId: 'usr_01',
    orgId: null,
    name: 'Windows Workstation',
    os: 'windows',
    hostname: 'DESKTOP-WIN11',
    status: 'offline',
    lastSeen: new Date(Date.now() - 3600000),
    createdAt: new Date('2024-02-01'),
    cpu: 0,
    memory: 0,
    disk: 0,
    sessionCount: 0,
  },
]

export function useMachines() {
  const { machines, setMachines } = useStore()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchMachines() {
      setIsLoading(true)
      try {
        // STUB: Replace with tRPC call: trpc.machines.list.query()
        // const res = await fetch('/api/machines')
        // const data = await res.json()
        await new Promise((resolve) => setTimeout(resolve, 400))
        setMachines(MOCK_MACHINES)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load machines')
      } finally {
        setIsLoading(false)
      }
    }

    fetchMachines()
  }, [setMachines])

  return { machines, isLoading, error }
}

export function useMachine(id: string) {
  const machines = useStore((s) => s.machines)
  const machine = machines.find((m) => m.id === id)
  const [isLoading, setIsLoading] = useState(!machine)

  useEffect(() => {
    if (!machine) {
      // STUB: Fetch individual machine if not in store
      setIsLoading(false)
    }
  }, [machine])

  return { machine, isLoading }
}
