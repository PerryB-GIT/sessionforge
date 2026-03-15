'use client'

export const dynamic = 'force-dynamic'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Plus, Radar, ChevronDown, ChevronUp, Terminal, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionList, type SessionSortKey } from '@/components/sessions/SessionList'
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
import { useStore, type SortDir, type DiscoveredProcess } from '@/store'
import type { SessionStatus } from '@/store'

type FilterStatus = 'all' | SessionStatus

const statusFilters: { label: string; value: FilterStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Stopped', value: 'stopped' },
  { label: 'Crashed', value: 'crashed' },
  { label: 'Paused', value: 'paused' },
]

function DiscoveredProcessesBanner() {
  const machines = useStore((s) => s.machines)
  const [expanded, setExpanded] = useState(true)

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
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-purple-500/10 transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <Radar className="h-4 w-4 text-purple-400 shrink-0" />
        <span className="text-sm font-medium text-purple-300 flex-1">
          {rows.length} unmanaged process{rows.length !== 1 ? 'es' : ''} detected
        </span>
        <span className="text-xs text-muted-foreground mr-2">Adopt — coming soon</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-gray-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-500" />
        )}
      </button>
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
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      Coming soon
                    </span>
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
  const updateSession = useStore((s) => s.updateSession)
  const removeSession = useStore((s) => s.removeSession)
  const [startOpen, setStartOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [machineFilter, setMachineFilter] = useState<string>('all')

  // Sorting
  const [sortKey, setSortKey] = useState<SessionSortKey>('startedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isStopping, setIsStopping] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)

  // Filtering
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

  // Sorting
  const getMachineNameForSession = (machineId: string) =>
    machines.find((m) => m.id === machineId)?.name ?? ''

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'processName') {
      cmp = a.processName.localeCompare(b.processName)
    } else if (sortKey === 'machine') {
      cmp = getMachineNameForSession(a.machineId).localeCompare(
        getMachineNameForSession(b.machineId)
      )
    } else if (sortKey === 'status') {
      cmp = a.status.localeCompare(b.status)
    } else if (sortKey === 'startedAt') {
      cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    } else if (sortKey === 'duration') {
      const durA =
        (a.stoppedAt ? new Date(a.stoppedAt).getTime() : Date.now()) -
        new Date(a.startedAt).getTime()
      const durB =
        (b.stoppedAt ? new Date(b.stoppedAt).getTime() : Date.now()) -
        new Date(b.startedAt).getTime()
      cmp = durA - durB
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleSort = useCallback(
    (key: SessionSortKey) => {
      setSortDir((prev) => (sortKey === key && prev === 'asc' ? 'desc' : 'asc'))
      setSortKey(key)
    },
    [sortKey]
  )

  // Selection handlers
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleToggleAll = useCallback((allIds: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = allIds.every((id) => prev.has(id))
      if (allSelected) return new Set()
      return new Set(allIds)
    })
  }, [])

  const clearSelection = () => setSelectedIds(new Set())

  // Bulk stop — only stops running/paused sessions; skips already-stopped/crashed
  const handleBulkStop = async () => {
    const toStop = sorted.filter(
      (s) => selectedIds.has(s.id) && (s.status === 'running' || s.status === 'paused')
    )
    if (toStop.length === 0) return

    setIsStopping(true)
    const results = await Promise.allSettled(
      toStop.map((s) =>
        fetch(`/api/sessions/${s.id}`, { method: 'DELETE' }).then((res) => {
          if (!res.ok) throw new Error(`Failed to stop session ${s.id}`)
          updateSession(s.id, { status: 'stopped', stoppedAt: new Date() })
        })
      )
    )
    setIsStopping(false)
    clearSelection()

    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed === toStop.length) {
      toast.error('Could not stop sessions')
    } else if (failed > 0) {
      toast.warning(`${failed} of ${toStop.length} sessions could not be stopped`)
    }
  }

  // Bulk dismiss — removes crashed/stopped sessions from the view (marks them stopped in DB)
  const handleBulkDismiss = async () => {
    const toDismiss = sorted.filter(
      (s) => selectedIds.has(s.id) && (s.status === 'stopped' || s.status === 'crashed')
    )
    if (toDismiss.length === 0) return

    setIsDismissing(true)
    const results = await Promise.allSettled(
      toDismiss.map((s) =>
        fetch(`/api/sessions/${s.id}`, { method: 'DELETE' }).then((res) => {
          if (!res.ok) throw new Error(`Failed to dismiss session ${s.id}`)
          removeSession(s.id)
        })
      )
    )
    setIsDismissing(false)
    clearSelection()

    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed === toDismiss.length) {
      toast.error('Could not dismiss sessions')
    } else if (failed > 0) {
      toast.warning(`${failed} of ${toDismiss.length} sessions could not be dismissed`)
    }
  }

  const selectedCount = selectedIds.size
  const stoppableCount = sorted.filter(
    (s) => selectedIds.has(s.id) && (s.status === 'running' || s.status === 'paused')
  ).length
  const dismissableCount = sorted.filter(
    (s) => selectedIds.has(s.id) && (s.status === 'stopped' || s.status === 'crashed')
  ).length

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

      {/* Unmanaged process discovery banner */}
      <DiscoveredProcessesBanner />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
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

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-purple-500/30 bg-purple-500/5 px-4 py-2.5">
          <span className="text-sm text-purple-300">{selectedCount} selected</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="text-gray-400 hover:text-white"
            >
              Clear
            </Button>
            {dismissableCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkDismiss}
                disabled={isDismissing}
                className="border-gray-500/40 text-gray-400 hover:bg-gray-500/10 hover:text-gray-300"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                {isDismissing ? 'Dismissing…' : `Dismiss ${dismissableCount}`}
              </Button>
            )}
            {stoppableCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkStop}
                disabled={isStopping}
                className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Square className="h-3.5 w-3.5 mr-1.5" />
                {isStopping ? 'Stopping…' : `Stop ${stoppableCount}`}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Session list */}
      <SessionList
        sessions={sorted}
        isLoading={isLoading}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onToggleAll={handleToggleAll}
      />

      <StartSessionDialog open={startOpen} onOpenChange={setStartOpen} />
    </div>
  )
}
