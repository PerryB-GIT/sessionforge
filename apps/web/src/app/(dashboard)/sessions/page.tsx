'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionList } from '@/components/sessions/SessionList'
import { StartSessionDialog } from '@/components/sessions/StartSessionDialog'
import { useSessions } from '@/hooks/useSessions'
import { useMachines } from '@/hooks/useMachines'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SessionStatus } from '@/store'

type FilterStatus = 'all' | SessionStatus

const statusFilters: { label: string; value: FilterStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Stopped', value: 'stopped' },
  { label: 'Crashed', value: 'crashed' },
  { label: 'Paused', value: 'paused' },
]

export default function SessionsPage() {
  const { sessions, isLoading } = useSessions()
  const { machines } = useMachines()
  const [startOpen, setStartOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [machineFilter, setMachineFilter] = useState<string>('all')

  const filtered = sessions
    .filter((s) => statusFilter === 'all' || s.status === statusFilter)
    .filter((s) => machineFilter === 'all' || s.machineId === machineFilter)

  const counts = {
    all: sessions.length,
    running: sessions.filter((s) => s.status === 'running').length,
    stopped: sessions.filter((s) => s.status === 'stopped').length,
    crashed: sessions.filter((s) => s.status === 'crashed').length,
    paused: sessions.filter((s) => s.status === 'paused').length,
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Sessions</h2>
          <p className="text-sm text-gray-400">
            {counts.running} active, {counts.stopped + counts.crashed} stopped
          </p>
        </div>
        <Button onClick={() => setStartOpen(true)}>
          <Plus className="h-4 w-4" />
          Start Session
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Status filter tabs */}
        <div className="flex items-center gap-1 border-b border-[#1e1e2e] w-full sm:w-auto">
          {statusFilters.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                statusFilter === value
                  ? 'border-purple-500 text-purple-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
              <span
                className={`text-xs rounded-full px-1.5 py-0.5 ${
                  statusFilter === value
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-[#1e1e2e] text-gray-600'
                }`}
              >
                {counts[value]}
              </span>
            </button>
          ))}
        </div>

        {/* Machine filter */}
        {machines.length > 0 && (
          <div className="sm:ml-auto w-full sm:w-48">
            <Select value={machineFilter} onValueChange={setMachineFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All machines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All machines</SelectItem>
                {machines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Session list */}
      <SessionList sessions={filtered} isLoading={isLoading} />

      {/* Start session dialog */}
      <StartSessionDialog open={startOpen} onOpenChange={setStartOpen} />
    </div>
  )
}
