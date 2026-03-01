'use client'

import Link from 'next/link'
import { Terminal, Clock, Monitor, ChevronRight } from 'lucide-react'
import { SessionStatusBadge } from '@/components/ui/badge'
import { formatDuration, formatRelativeTime, truncate } from '@/lib/utils'
import type { Session } from '@/store'
import { useStore } from '@/store'

interface SessionListProps {
  sessions: Session[]
  isLoading?: boolean
  compact?: boolean
}

function SessionRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-[#1e1e2e] animate-pulse">
      <div className="h-7 w-7 rounded-lg bg-[#1e1e2e]" />
      <div className="flex-1 space-y-1">
        <div className="h-3.5 w-24 rounded bg-[#1e1e2e]" />
        <div className="h-3 w-40 rounded bg-[#1e1e2e]" />
      </div>
      <div className="h-6 w-16 rounded-full bg-[#1e1e2e]" />
    </div>
  )
}

export function SessionList({ sessions, isLoading, compact = false }: SessionListProps) {
  const machines = useStore((s) => s.machines)

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden">
        {[1, 2, 3].map((i) => <SessionRowSkeleton key={i} />)}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1e1e2e] py-16">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1e1e2e] mb-3">
          <Terminal className="h-5 w-5 text-gray-600" />
        </div>
        <h3 className="text-sm font-medium text-white mb-1">No sessions</h3>
        <p className="text-xs text-gray-500">Start a session to see it here</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden">
      {/* Table header (non-compact) */}
      {!compact && (
        <div className="grid grid-cols-[1fr_140px_100px_120px_80px_32px] gap-4 px-4 py-2.5 border-b border-[#1e1e2e] text-xs font-medium text-gray-500">
          <span>Session</span>
          <span>Machine</span>
          <span>Status</span>
          <span>Started</span>
          <span>Duration</span>
          <span />
        </div>
      )}

      {/* Rows */}
      <div>
        {sessions.map((session, i) => {
          const machine = machines.find((m) => m.id === session.machineId)
          return (
            <Link
              key={session.id}
              href={`/sessions/${session.id}`}
              className={`grid ${compact ? 'grid-cols-[1fr_100px_32px]' : 'grid-cols-[1fr_140px_100px_120px_80px_32px]'} items-center gap-4 px-4 py-3.5 hover:bg-[#1e1e2e]/50 transition-colors group ${
                i > 0 ? 'border-t border-[#1e1e2e]' : ''
              }`}
            >
              {/* Session info */}
              <div className="flex items-center gap-3 min-w-0">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  session.status === 'running' ? 'bg-green-500/10' :
                  session.status === 'crashed' ? 'bg-red-500/10' : 'bg-[#1e1e2e]'
                }`}>
                  <Terminal className={`h-3.5 w-3.5 ${
                    session.status === 'running' ? 'text-green-400' :
                    session.status === 'crashed' ? 'text-red-400' : 'text-gray-500'
                  }`} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {session.processName}
                  </div>
                  {session.workdir && (
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {truncate(session.workdir, 40)}
                    </div>
                  )}
                </div>
              </div>

              {/* Machine (non-compact) */}
              {!compact && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400 truncate">
                  <Monitor className="h-3 w-3 shrink-0 text-gray-600" />
                  <span className="truncate">{machine?.name ?? 'Unknown'}</span>
                </div>
              )}

              {/* Status */}
              <div>
                <SessionStatusBadge status={session.status} />
              </div>

              {/* Started (non-compact) */}
              {!compact && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(session.startedAt)}
                </div>
              )}

              {/* Duration (non-compact) */}
              {!compact && (
                <div className="text-xs text-gray-500 tabular-nums">
                  {formatDuration(session.startedAt, session.stoppedAt)}
                </div>
              )}

              {/* Chevron */}
              <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
