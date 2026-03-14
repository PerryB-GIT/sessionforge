'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Terminal,
  Clock,
  Monitor,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Share2,
  LogIn,
} from 'lucide-react'
import { SessionStatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDuration, formatRelativeTime, truncate } from '@/lib/utils'
import type { Session } from '@/store'
import { useStore, type SortDir } from '@/store'
import { toast } from 'sonner'

export type SessionSortKey = 'processName' | 'machine' | 'status' | 'startedAt' | 'duration'

interface SessionListProps {
  sessions: Session[]
  isLoading?: boolean
  compact?: boolean
  sortKey?: SessionSortKey
  sortDir?: SortDir
  onSort?: (key: SessionSortKey) => void
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleAll?: (allIds: string[]) => void
}

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: SessionSortKey
  sortKey?: SessionSortKey
  sortDir?: SortDir
}) {
  if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 text-gray-600 ml-1 inline" />
  return sortDir === 'asc' ? (
    <ArrowUp className="h-3 w-3 text-purple-400 ml-1 inline" />
  ) : (
    <ArrowDown className="h-3 w-3 text-purple-400 ml-1 inline" />
  )
}

function SortableHeader({
  col,
  label,
  sortKey,
  sortDir,
  onSort,
}: {
  col: SessionSortKey
  label: string
  sortKey?: SessionSortKey
  sortDir?: SortDir
  onSort?: (key: SessionSortKey) => void
}) {
  return (
    <button
      className={`flex items-center gap-0.5 text-xs font-medium transition-colors ${
        sortKey === col ? 'text-purple-400' : 'text-gray-500 hover:text-gray-300'
      }`}
      onClick={() => onSort?.(col)}
    >
      {label}
      <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
    </button>
  )
}

function SessionSummary({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchSummary() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/summary`)
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled && json.data?.summary) {
          setSummary(json.data.summary)
        }
      } catch {
        // silently ignore — summary is best-effort
      }
    }

    fetchSummary()
    const interval = setInterval(fetchSummary, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [sessionId])

  if (!summary) return null

  return <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">{summary}</p>
}

function SessionRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-[#1e1e2e] animate-pulse">
      <div className="h-4 w-4 rounded bg-[#1e1e2e] shrink-0" />
      <div className="h-7 w-7 rounded-lg bg-[#1e1e2e]" />
      <div className="flex-1 space-y-1">
        <div className="h-3.5 w-24 rounded bg-[#1e1e2e]" />
        <div className="h-3 w-40 rounded bg-[#1e1e2e]" />
      </div>
      <div className="h-6 w-16 rounded-full bg-[#1e1e2e]" />
    </div>
  )
}

export function SessionList({
  sessions,
  isLoading,
  compact = false,
  sortKey,
  sortDir,
  onSort,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: SessionListProps) {
  const machines = useStore((s) => s.machines)
  const user = useStore((s) => s.user)
  const updateSession = useStore((s) => s.updateSession)
  const router = useRouter()

  async function handleToggleShare(e: React.MouseEvent, session: Session) {
    e.stopPropagation()
    const method = session.adoptable ? 'DELETE' : 'POST'
    try {
      const res = await fetch(`/api/sessions/${session.id}/adopt`, { method })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to update share status')
        return
      }
      updateSession(session.id, { adoptable: json.data.adoptable })
      toast.success(json.data.adoptable ? 'Session is now shared' : 'Session sharing revoked')
    } catch {
      toast.error('Failed to update share status')
    }
  }

  const selectable = !!onToggleSelect
  const allSelected =
    selectable && sessions.length > 0 && sessions.every((s) => selectedIds?.has(s.id))
  const someSelected = selectable && sessions.some((s) => selectedIds?.has(s.id))

  // Grid: checkbox col | session | machine | status | started | duration | action | chevron
  const gridCols = compact
    ? 'grid-cols-[1fr_100px_32px]'
    : selectable
      ? 'grid-cols-[20px_1fr_140px_120px_120px_80px_32px_32px]'
      : 'grid-cols-[1fr_140px_120px_120px_80px_32px_32px]'

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden">
        {[1, 2, 3].map((i) => (
          <SessionRowSkeleton key={i} />
        ))}
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
      {/* Table header */}
      {!compact && (
        <div
          className={`grid ${gridCols} items-center gap-4 px-4 py-2.5 border-b border-[#1e1e2e]`}
        >
          {selectable && (
            <input
              type="checkbox"
              aria-label="Select all sessions"
              className="h-4 w-4 rounded border-gray-600 bg-[#1e1e2e] accent-purple-500 cursor-pointer"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = !allSelected && someSelected
              }}
              onChange={() => onToggleAll?.(sessions.map((s) => s.id))}
            />
          )}
          <SortableHeader
            col="processName"
            label="Session"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortableHeader
            col="machine"
            label="Machine"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortableHeader
            col="status"
            label="Status"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortableHeader
            col="startedAt"
            label="Started"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
          <SortableHeader
            col="duration"
            label="Duration"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
          <span />
          <span />
        </div>
      )}

      {/* Rows */}
      <div>
        {sessions.map((session, i) => {
          const machine = machines.find((m) => m.id === session.machineId)
          const isSelected = selectedIds?.has(session.id) ?? false

          return (
            <div
              key={session.id}
              className={`grid ${gridCols} items-center gap-4 px-4 py-3.5 transition-colors group cursor-pointer ${
                i > 0 ? 'border-t border-[#1e1e2e]' : ''
              } ${isSelected ? 'bg-purple-500/10' : 'hover:bg-[#1e1e2e]/50'}`}
              onClick={() => router.push(`/sessions/${session.id}`)}
            >
              {/* Checkbox */}
              {selectable && !compact && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-600 bg-[#1e1e2e] accent-purple-500 cursor-pointer"
                    checked={isSelected}
                    onChange={() => onToggleSelect?.(session.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}

              {/* Session info */}
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    session.status === 'running'
                      ? 'bg-green-500/10'
                      : session.status === 'crashed'
                        ? 'bg-red-500/10'
                        : 'bg-[#1e1e2e]'
                  }`}
                >
                  <Terminal
                    className={`h-3.5 w-3.5 ${
                      session.status === 'running'
                        ? 'text-green-400'
                        : session.status === 'crashed'
                          ? 'text-red-400'
                          : 'text-gray-500'
                    }`}
                  />
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
                  {session.status === 'running' && <SessionSummary sessionId={session.id} />}
                </div>
              </div>

              {/* Machine */}
              {!compact && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400 truncate">
                  <Monitor className="h-3 w-3 shrink-0 text-gray-600" />
                  <span className="truncate">{machine?.name ?? 'Unknown'}</span>
                </div>
              )}

              {/* Status + adoptable badge */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <SessionStatusBadge status={session.status} />
                {session.adoptable && (
                  <span className="inline-flex items-center rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-500/30">
                    Shared
                  </span>
                )}
              </div>

              {/* Started */}
              {!compact && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(session.startedAt)}
                </div>
              )}

              {/* Duration */}
              {!compact && (
                <div className="text-xs text-gray-500 tabular-nums">
                  {formatDuration(session.startedAt, session.stoppedAt)}
                </div>
              )}

              {/* Share / Adopt actions */}
              {!compact &&
                (() => {
                  const isOwner = user?.id === session.userId
                  if (isOwner && session.status === 'running') {
                    return (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={session.adoptable ? 'Revoke sharing' : 'Share session'}
                        onClick={(e) => handleToggleShare(e, session)}
                        className={
                          session.adoptable
                            ? 'text-green-400 hover:text-green-300'
                            : 'text-gray-500 hover:text-gray-300'
                        }
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </Button>
                    )
                  }
                  if (!isOwner && session.adoptable) {
                    return (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Adopt session"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/sessions/${session.id}`)
                        }}
                        className="text-purple-400 hover:text-purple-300"
                      >
                        <LogIn className="h-3.5 w-3.5" />
                      </Button>
                    )
                  }
                  return null
                })()}

              {/* Chevron */}
              <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
            </div>
          )
        })}
      </div>
    </div>
  )
}
