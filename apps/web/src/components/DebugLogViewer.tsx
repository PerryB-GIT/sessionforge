'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'

interface DebugLog {
  id: string
  machineId: string
  level: string
  component: string
  message: string
  metadata: Record<string, unknown> | null
  agentVersion: string | null
  createdAt: string
}

interface DebugLogViewerProps {
  machineId: string
}

const levelBadgeClass: Record<string, string> = {
  debug: 'bg-gray-500/20 text-gray-400',
  info: 'bg-blue-500/20 text-blue-400',
  warn: 'bg-yellow-500/20 text-yellow-400',
  error: 'bg-red-500/20 text-red-400',
}

export function DebugLogViewer({ machineId }: DebugLogViewerProps) {
  const [logs, setLogs] = useState<DebugLog[]>([])
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [isLoading, setIsLoading] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const fetchLogs = useCallback(async () => {
    setIsLoading(true)
    try {
      const url =
        levelFilter && levelFilter !== 'all'
          ? `/api/machines/${machineId}/debug-log?level=${levelFilter}`
          : `/api/machines/${machineId}/debug-log`
      const res = await fetch(url)
      const json = await res.json()
      if (res.ok) {
        setLogs(json.data ?? [])
      }
    } catch {
      // silently ignore — we'll retry on next interval
    } finally {
      setIsLoading(false)
    }
  }, [machineId, levelFilter])

  useEffect(() => {
    void fetchLogs()
    const interval = setInterval(() => void fetchLogs(), 10_000)
    return () => clearInterval(interval)
  }, [fetchLogs])

  async function handleClear() {
    setIsClearing(true)
    try {
      const res = await fetch(`/api/machines/${machineId}/debug-log`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to clear logs')
        return
      }
      setLogs([])
      toast.success(`Cleared ${json.data?.deleted ?? 0} log entries`)
    } catch {
      toast.error('Failed to clear logs')
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All levels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => void fetchLogs()} disabled={isLoading}>
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleClear()}
          disabled={isClearing || logs.length === 0}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>

      {/* Table */}
      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1e1e2e] py-16">
          <p className="text-sm text-gray-500">
            No debug logs yet. Debug logs appear when the agent encounters issues.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden">
          <div className="grid grid-cols-[120px_72px_160px_1fr] gap-4 px-4 py-2.5 border-b border-[#1e1e2e] text-xs font-medium text-gray-500">
            <span>Time</span>
            <span>Level</span>
            <span>Component</span>
            <span>Message</span>
          </div>
          <div>
            {logs.map((log, i) => (
              <div
                key={log.id}
                className={`grid grid-cols-[120px_72px_160px_1fr] items-start gap-4 px-4 py-3 text-sm ${
                  i > 0 ? 'border-t border-[#1e1e2e]' : ''
                }`}
              >
                <span className="text-xs text-gray-500 tabular-nums">
                  {formatRelativeTime(new Date(log.createdAt))}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium w-fit ${
                    levelBadgeClass[log.level] ?? levelBadgeClass.debug
                  }`}
                >
                  {log.level}
                </span>
                <span className="text-xs text-gray-400 font-mono truncate">{log.component}</span>
                <span className="text-xs text-gray-300 break-all">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
