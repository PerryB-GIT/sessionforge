'use client'

import { MachineCard } from './MachineCard'
import type { Machine } from '@/store'

interface MachineGridProps {
  machines: Machine[]
  isLoading?: boolean
}

function MachineCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-5 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-[#1e1e2e]" />
          <div className="space-y-1">
            <div className="h-3.5 w-28 rounded bg-[#1e1e2e]" />
            <div className="h-3 w-20 rounded bg-[#1e1e2e]" />
          </div>
        </div>
        <div className="h-6 w-16 rounded-full bg-[#1e1e2e]" />
      </div>
      <div className="space-y-2.5 mb-4">
        {[1, 2, 3].map((i) => (
          <div key={i}>
            <div className="flex justify-between mb-1">
              <div className="h-3 w-8 rounded bg-[#1e1e2e]" />
              <div className="h-3 w-8 rounded bg-[#1e1e2e]" />
            </div>
            <div className="h-1 rounded bg-[#1e1e2e]" />
          </div>
        ))}
      </div>
      <div className="flex justify-between pt-3 border-t border-[#1e1e2e]">
        <div className="h-3 w-16 rounded bg-[#1e1e2e]" />
        <div className="h-3 w-16 rounded bg-[#1e1e2e]" />
      </div>
    </div>
  )
}

export function MachineGrid({ machines, isLoading }: MachineGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <MachineCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (machines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1e1e2e] py-20">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#1e1e2e] mb-4">
          <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-sm font-medium text-white mb-1">No machines found</h3>
        <p className="text-xs text-gray-500">Add your first machine to get started</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {machines.map((machine) => (
        <MachineCard key={machine.id} machine={machine} />
      ))}
    </div>
  )
}
