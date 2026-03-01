'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { Plus, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MachineGrid } from '@/components/machines/MachineGrid'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { MachineSetupWizard } from '@/components/machines/MachineSetupWizard'
import { useMachines } from '@/hooks/useMachines'
import type { MachineStatus } from '@/store'

type FilterType = 'all' | MachineStatus

const filters: { label: string; value: FilterType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Online', value: 'online' },
  { label: 'Offline', value: 'offline' },
  { label: 'Error', value: 'error' },
]

export default function MachinesPage() {
  const { machines, isLoading } = useMachines()
  const [filter, setFilter] = useState<FilterType>('all')
  const [wizardOpen, setWizardOpen] = useState(false)

  const filtered = filter === 'all' ? machines : machines.filter((m) => m.status === filter)

  const counts = {
    all: machines.length,
    online: machines.filter((m) => m.status === 'online').length,
    offline: machines.filter((m) => m.status === 'offline').length,
    error: machines.filter((m) => m.status === 'error').length,
  }

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
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Machine
        </Button>
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

      {/* Machine grid */}
      <MachineGrid machines={filtered} isLoading={isLoading} />

      {/* Setup wizard dialog */}
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
