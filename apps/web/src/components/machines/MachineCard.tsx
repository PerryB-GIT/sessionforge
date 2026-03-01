'use client'

import Link from 'next/link'
import { Monitor, Apple, Terminal, Clock, Cpu, MemoryStick, HardDrive } from 'lucide-react'
import { MachineStatusBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatRelativeTime } from '@/lib/utils'
import type { Machine } from '@/store'
import { cn } from '@/lib/utils'

function OsIcon({ os, className }: { os: Machine['os']; className?: string }) {
  const icons = {
    macos: Apple,
    linux: Terminal,
    windows: Monitor,
  }
  const Icon = icons[os]
  return <Icon className={className} />
}

function MetricBar({
  label,
  value,
  colorClass,
}: {
  label: string
  value?: number
  colorClass: string
}) {
  if (value === undefined) return null
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">{label}</span>
        <span className={cn('font-medium tabular-nums', colorClass)}>{value}%</span>
      </div>
      <Progress
        value={value}
        className="h-1"
        indicatorClassName={cn(
          value > 80 ? 'bg-red-400' : value > 60 ? 'bg-yellow-400' : 'bg-purple-500'
        )}
      />
    </div>
  )
}

interface MachineCardProps {
  machine: Machine
}

export function MachineCard({ machine }: MachineCardProps) {
  const isOnline = machine.status === 'online'

  return (
    <Link href={`/machines/${machine.id}`}>
      <Card
        className={cn(
          'group cursor-pointer transition-all duration-200 hover:border-purple-500/40 hover:shadow-lg hover:shadow-purple-500/5',
          !isOnline && 'opacity-70'
        )}
      >
        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg',
                  isOnline ? 'bg-purple-500/10' : 'bg-[#1e1e2e]'
                )}
              >
                <OsIcon
                  os={machine.os}
                  className={cn(
                    'h-5 w-5',
                    isOnline ? 'text-purple-400' : 'text-gray-500'
                  )}
                />
              </div>
              <div className="overflow-hidden">
                <h3 className="text-sm font-semibold text-white truncate group-hover:text-purple-300 transition-colors">
                  {machine.name}
                </h3>
                <p className="text-xs text-gray-500 truncate">{machine.hostname}</p>
              </div>
            </div>
            <MachineStatusBadge status={machine.status} />
          </div>

          {/* Metrics */}
          {isOnline && (
            <div className="space-y-2.5 mb-4">
              <MetricBar label="CPU" value={machine.cpu} colorClass={
                (machine.cpu ?? 0) > 80 ? 'text-red-400' : 'text-gray-300'
              } />
              <MetricBar label="Memory" value={machine.memory} colorClass={
                (machine.memory ?? 0) > 80 ? 'text-red-400' : 'text-gray-300'
              } />
              <MetricBar label="Disk" value={machine.disk} colorClass={
                (machine.disk ?? 0) > 80 ? 'text-red-400' : 'text-gray-300'
              } />
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-[#1e1e2e]">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Clock className="h-3 w-3" />
              <span>{formatRelativeTime(machine.lastSeen)}</span>
            </div>
            {isOnline && machine.sessionCount !== undefined && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Terminal className="h-3 w-3" />
                <span>{machine.sessionCount} session{machine.sessionCount !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  )
}
