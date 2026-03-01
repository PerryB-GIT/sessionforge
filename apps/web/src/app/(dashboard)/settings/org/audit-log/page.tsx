'use client'

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type AuditAction =
  | 'member.invited'
  | 'member.removed'
  | 'session.started'
  | 'session.stopped'
  | 'machine.added'
  | 'machine.deleted'
  | 'sso.login'
  | 'sso.fallback'
  | 'api_key.created'
  | 'api_key.deleted'
  | 'plan.changed'
  | 'ip_allowlist.updated'

const ACTION_COLORS: Record<AuditAction, string> = {
  'member.invited': 'text-green-400',
  'member.removed': 'text-red-400',
  'session.started': 'text-blue-400',
  'session.stopped': 'text-gray-400',
  'machine.added': 'text-green-400',
  'machine.deleted': 'text-red-400',
  'sso.login': 'text-purple-400',
  'sso.fallback': 'text-yellow-400',
  'api_key.created': 'text-green-400',
  'api_key.deleted': 'text-red-400',
  'plan.changed': 'text-yellow-400',
  'ip_allowlist.updated': 'text-orange-400',
}

interface AuditRow {
  id: string
  action: string
  targetId: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: string
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [planError, setPlanError] = useState(false)

  async function load(pageNum: number, filter: string, replace: boolean) {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(pageNum) })
      if (filter !== 'all') params.set('action', filter)
      const res = await fetch(`/api/org/audit-log?${params}`)
      const j = await res.json()
      if (res.status === 403) {
        setPlanError(true)
        return
      }
      const newRows: AuditRow[] = j.data ?? []
      setHasMore(newRows.length === 50)
      setRows((prev) => (replace ? newRows : [...prev, ...newRows]))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setPage(0)
    setRows([])
    setHasMore(true)
    load(0, actionFilter, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter])

  function loadMore() {
    const nextPage = page + 1
    setPage(nextPage)
    load(nextPage, actionFilter, false)
  }

  function exportCsv() {
    const headers = ['Time', 'Action', 'Actor', 'Target', 'IP']
    const csvRows = rows.map((r) => [
      new Date(r.createdAt).toISOString(),
      r.action,
      r.actorEmail ?? r.actorName ?? r.actorId ?? 'System',
      r.targetId ?? '',
      r.ip ?? '',
    ])
    const csv = [headers, ...csvRows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (planError) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Audit Log</h2>
        <p className="text-sm text-gray-400">Audit log requires an Enterprise plan.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Audit Log</h2>
        <div className="flex items-center gap-2">
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {(Object.keys(ACTION_COLORS) as AuditAction[]).map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-gray-400">
            {rows.length} event{rows.length !== 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 && !isLoading && (
            <p className="text-sm text-gray-500 p-4">No audit events found.</p>
          )}
          <div className="divide-y divide-[#1e1e2e]">
            {rows.map((row) => (
              <div key={row.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="text-gray-500 font-mono text-xs w-44 shrink-0 pt-0.5">
                  {new Date(row.createdAt).toLocaleString()}
                </span>
                <span
                  className={`font-mono font-medium w-40 shrink-0 ${ACTION_COLORS[row.action as AuditAction] ?? 'text-gray-300'}`}
                >
                  {row.action}
                </span>
                <span className="text-gray-400 min-w-0 truncate">
                  {row.actorEmail ?? row.actorName ?? row.actorId ?? 'System'}
                  {row.targetId && <span className="text-gray-600 ml-1">→ {row.targetId}</span>}
                </span>
                {row.ip && (
                  <span className="text-gray-600 font-mono text-xs ml-auto shrink-0">{row.ip}</span>
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <div className="p-4 text-center">
              <Button size="sm" variant="outline" onClick={loadMore} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Load more'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
