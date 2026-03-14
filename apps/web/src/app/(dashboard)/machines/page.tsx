'use client'

export const dynamic = 'force-dynamic'

import { useState, useCallback } from 'react'
import { Plus, RefreshCw, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MachineGrid, type MachineSortKey, type SortDir } from '@/components/machines/MachineGrid'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { MachineSetupWizard } from '@/components/machines/MachineSetupWizard'
import { useMachines } from '@/hooks/useMachines'
import { useStore } from '@/store'
import type { MachineStatus } from '@/store'

type FilterType = 'all' | MachineStatus

const filters: { label: string; value: FilterType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Online', value: 'online' },
  { label: 'Offline', value: 'offline' },
  { label: 'Error', value: 'error' },
]

const sortOptions: { label: string; value: MachineSortKey }[] = [
  { label: 'Name', value: 'name' },
  { label: 'Status', value: 'status' },
  { label: 'Last Seen', value: 'lastSeen' },
  { label: 'OS', value: 'os' },
]

export default function MachinesPage() {
  const { machines, isLoading, refetch } = useMachines()
  const removeMachine = useStore((s) => s.removeMachine)
  const [filter, setFilter] = useState<FilterType>('all')
  const [wizardOpen, setWizardOpen] = useState(false)

  // Sorting
  const [sortKey, setSortKey] = useState<MachineSortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const counts = {
    all: machines.length,
    online: machines.filter((m) => m.status === 'online').length,
    offline: machines.filter((m) => m.status === 'offline').length,
    error: machines.filter((m) => m.status === 'error').length,
  }

  // Filter
  const filtered = filter === 'all' ? machines : machines.filter((m) => m.status === filter)

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
    else if (sortKey === 'status') cmp = a.status.localeCompare(b.status)
    else if (sortKey === 'os') cmp = a.os.localeCompare(b.os)
    else if (sortKey === 'lastSeen') {
      const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0
      const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0
      cmp = ta - tb
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleSortClick = (key: MachineSortKey) => {
    setSortDir((prev) => (sortKey === key && prev === 'asc' ? 'desc' : 'asc'))
    setSortKey(key)
  }

  // Selection
  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = () => setSelectedIds(new Set())

  // Bulk delete
  const handleBulkDelete = async () => {
    setIsDeleting(true)
    const ids = Array.from(selectedIds)
    await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/machines/${id}`, { method: 'DELETE' }).then((res) => {
          if (res.ok) removeMachine(id)
        })
      )
    )
    setIsDeleting(false)
    setDeleteConfirmOpen(false)
    clearSelection()
  }

  const selectedCount = selectedIds.size

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Machines</h2>
          <p className="text-sm text-gray-400">
            {counts.online} online, {counts.offline} offline
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Machine
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-[#1e1e2e]">
        {filters.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              filter === value
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
            <span
              className={`text-xs rounded-full px-1.5 py-0.5 ${
                filter === value ? 'bg-purple-500/20 text-purple-400' : 'bg-[#1e1e2e] text-gray-600'
              }`}
            >
              {counts[value]}
            </span>
          </button>
        ))}
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Sort:</span>
        {sortOptions.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => handleSortClick(value)}
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              sortKey === value
                ? 'border-purple-500/50 bg-purple-500/10 text-purple-400'
                : 'border-[#1e1e2e] text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {label}
            {sortKey === value ? (
              sortDir === 'asc' ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )
            ) : (
              <ArrowUpDown className="h-3 w-3 opacity-40" />
            )}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5">
          <span className="text-sm text-red-300">
            {selectedCount} machine{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="text-gray-400 hover:text-white"
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeleteConfirmOpen(true)}
              className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete {selectedCount}
            </Button>
          </div>
        </div>
      )}

      {/* Machine grid */}
      <MachineGrid
        machines={sorted}
        isLoading={isLoading}
        selectedIds={selectedIds}
        onToggle={handleToggle}
      />

      {/* Bulk delete confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              Delete {selectedCount} machine{selectedCount !== 1 ? 's' : ''}?
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              This will permanently deregister {selectedCount} machine
              {selectedCount !== 1 ? 's' : ''} and{' '}
              <span className="text-red-400 font-medium">
                delete all associated sessions and logs
              </span>
              . This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : `Delete ${selectedCount}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Setup wizard */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a New Machine</DialogTitle>
            <DialogDescription>
              Install the SessionForge agent on any machine to start managing it.
            </DialogDescription>
          </DialogHeader>
          <MachineSetupWizard onComplete={() => setWizardOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
