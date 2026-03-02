'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { Plus, Radar, ChevronDown, ChevronUp, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionList } from '@/components/sessions/SessionList'
import { StartSessionDialog } from '@/components/sessions/StartSessionDialog'
import { useSessions } from '@/hooks/useSessions'
import { useMachines } from '@/hooks/useMachines'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useStore, type DiscoveredProcess } from '@/store'
import type { SessionStatus } from '@/store'

type FilterStatus = 'all' | SessionStatus

const statusFilters: { label: string; value: FilterStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Stopped', value: 'stopped' },
  { label: 'Crashed', value: 'crashed' },
  { label: 'Paused', value: 'paused' },
]

interface AdoptTarget {
  machineId: string
  command: string
  workdir: string
}

function DiscoveredProcessesBanner({ onAdopt }: { onAdopt: (target: AdoptTarget) => void }) {
  const machines = useStore((s) => s.machines)
  const [expanded, setExpanded] = useState(true)

  // Collect all unmanaged processes across all online machines
  const rows: Array<{ machineId: string; machineName: string; process: DiscoveredProcess }> = []
  for (const m of machines) {
    if (m.status !== 'online') continue
    for (const p of m.discoveredProcesses ?? []) {
      rows.push({ machineId: m.id, machineName: m.name, process: p })
    }
  }

  if (rows.length === 0) return null

  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-purple-500/10 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <Radar className="h-4 w-4 text-purple-400 shrink-0" />
        <span className="text-sm font-medium text-purple-300 flex-1">
          {rows.length} unmanaged process{rows.length !== 1 ? 'es' : ''} detected
        </span>
        <span className="text-xs text-gray-500 mr-2">Click Adopt to bring into SessionForge</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-gray-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-500" />
        )}
      </button>

      {/* Table */}
      {expanded && (
        <div className="border-t border-purple-500/20 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-purple-500/10">
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Machine</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Process</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Command</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium hidden md:table-cell">
                  Working Dir
                </th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ machineId, machineName, process: p }) => (
                <tr
                  key={`${machineId}-${p.pid}`}
                  className="border-b border-purple-500/10 last:border-0 hover:bg-purple-500/5"
                >
                  <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{machineName}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="h-3 w-3 text-purple-400" />
                      <span className="text-purple-300 font-mono">{p.name}</span>
                      <span className="text-gray-600">PID {p.pid}</span>
                    </div>
                  </td>
                  <td
                    className="px-4 py-2.5 text-gray-400 font-mono max-w-[200px] truncate"
                    title={p.cmdline}
                  >
                    {p.cmdline || p.name}
                  </td>
                  <td
                    className="px-4 py-2.5 text-gray-500 font-mono max-w-[180px] truncate hidden md:table-cell"
                    title={p.workdir}
                  >
                    {p.workdir || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2 border-purple-500/40 text-purple-300 hover:bg-purple-500/20"
                      onClick={() =>
                        onAdopt({
                          machineId,
                          command: p.cmdline || p.name,
                          workdir: p.workdir,
                        })
                      }
                    >
                      Adopt
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function SessionsPage() {
  const { sessions, isLoading } = useSessions()
  const { machines } = useMachines()
  const [startOpen, setStartOpen] = useState(false)
  const [adoptTarget, setAdoptTarget] = useState<AdoptTarget | null>(null)
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

  function handleAdopt(target: AdoptTarget) {
    setAdoptTarget(target)
    setStartOpen(true)
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
        <Button
          onClick={() => {
            setAdoptTarget(null)
            setStartOpen(true)
          }}
        >
          <Plus className="h-4 w-4" />
          Start Session
        </Button>
      </div>

      {/* Unmanaged process discovery banner */}
      <DiscoveredProcessesBanner onAdopt={handleAdopt} />

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

      {/* Start / Adopt session dialog */}
      <StartSessionDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        defaultMachineId={adoptTarget?.machineId}
        defaultCommand={adoptTarget?.command}
        defaultWorkdir={adoptTarget?.workdir}
      />
    </div>
  )
}
