'use client'

import { useEffect, useState } from 'react'
import { useStore, type Machine } from '@/store'

export function useMachines() {
  const { machines, setMachines } = useStore()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchMachines() {
      setIsLoading(true)
      try {
        const res = await fetch('/api/machines')
        if (!res.ok) throw new Error('Failed to load machines')
        const json = await res.json()
        if (json.data?.items) {
          const machines: Machine[] = json.data.items.map((m: {
            id: string
            userId: string
            orgId: string | null
            name: string
            os: string
            hostname: string
            status: string
            lastSeen: string | null
            createdAt: string
          }) => ({
            id: m.id,
            userId: m.userId,
            orgId: m.orgId,
            name: m.name,
            os: m.os,
            hostname: m.hostname,
            status: m.status,
            lastSeen: m.lastSeen ? new Date(m.lastSeen) : null,
            createdAt: new Date(m.createdAt),
          }))
          setMachines(machines)
        }
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
  const { machines, addMachine } = useStore()
  const machine = machines.find((m) => m.id === id)
  const [isLoading, setIsLoading] = useState(!machine)

  useEffect(() => {
    if (machine) {
      setIsLoading(false)
      return
    }
    // Not in store (direct navigation) — fetch individually
    async function fetchMachine() {
      try {
        const res = await fetch(`/api/machines/${id}`)
        if (!res.ok) return
        const json = await res.json()
        if (json.data) {
          const m = json.data
          addMachine({
            id: m.id,
            userId: m.userId,
            orgId: m.orgId,
            name: m.name,
            os: m.os,
            hostname: m.hostname,
            status: m.status,
            lastSeen: m.lastSeen ? new Date(m.lastSeen) : null,
            createdAt: new Date(m.createdAt),
          })
        }
      } finally {
        setIsLoading(false)
      }
    }
    fetchMachine()
  }, [id, machine, addMachine])

  return { machine, isLoading }
}
