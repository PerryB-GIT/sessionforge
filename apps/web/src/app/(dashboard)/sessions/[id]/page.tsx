'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Square, Monitor, Clock, Cpu, MemoryStick } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SessionStatusBadge } from '@/components/ui/badge'
import { Terminal } from '@/components/sessions/Terminal'
import { useSession } from '@/hooks/useSessions'
import { useStore } from '@/store'
import { useWebSocket } from '@/hooks/useWebSocket'
import { formatDuration, formatRelativeTime, truncate } from '@/lib/utils'
import { toast } from 'sonner'

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { session, isLoading } = useSession(id)
  const machines = useStore((s) => s.machines)
  const updateSession = useStore((s) => s.updateSession)
  const { sendMessage, wsStatus } = useWebSocket()
  const [isStopping, setIsStopping] = useState(false)

  const machine = session ? machines.find((m) => m.id === session.machineId) : null
  const isConnected = wsStatus === 'connected'

  function handleSendInput(data: string) {
    // STUB: Send input through dashboard WS
    sendMessage({
      type: 'session_input',
      sessionId: id,
      data: btoa(data), // base64 encode
    })
  }

  async function stopSession() {
    if (!session) return
    setIsStopping(true)
    try {
      // STUB: Send stop command via WS or tRPC
      sendMessage({ type: 'stop_session', sessionId: id })
      await new Promise((r) => setTimeout(r, 500))
      updateSession(id, { status: 'stopped', stoppedAt: new Date() })
      toast.success('Session stopped')
    } catch {
      toast.error('Failed to stop session')
    } finally {
      setIsStopping(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full gap-4 animate-pulse max-w-7xl">
        <div className="h-8 w-64 rounded bg-[#1e1e2e]" />
        <div className="h-24 rounded-xl bg-[#111118] border border-[#1e1e2e]" />
        <div className="flex-1 rounded-xl bg-[#111118] border border-[#1e1e2e]" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-400 mb-4">Session not found</p>
        <Link href="/sessions">
          <Button variant="outline">Back to Sessions</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full max-w-7xl">
      {/* Back + header */}
      <div className="flex items-center gap-3 shrink-0">
        <Link href="/sessions">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">
            {session.processName}
          </div>
          {session.workdir && (
            <span className="text-xs text-gray-500 font-mono hidden sm:block">
              {truncate(session.workdir, 40)}
            </span>
          )}
          <SessionStatusBadge status={session.status} />
        </div>
        {session.status === 'running' && (
          <Button
            variant="destructive"
            size="sm"
            onClick={stopSession}
            isLoading={isStopping}
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}
      </div>

      {/* Meta info row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Monitor className="h-4 w-4 text-purple-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Machine</p>
              <p className="text-sm text-white truncate">{machine?.name ?? 'Unknown'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Duration</p>
              <p className="text-sm text-white tabular-nums">
                {formatDuration(session.startedAt, session.stoppedAt)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-green-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Avg CPU</p>
              <p className="text-sm text-white">
                {session.avgCpuPercent !== null ? `${session.avgCpuPercent}%` : '—'}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <MemoryStick className="h-4 w-4 text-yellow-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Peak Memory</p>
              <p className="text-sm text-white">
                {session.peakMemoryMb !== null ? `${session.peakMemoryMb} MB` : '—'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0" style={{ minHeight: '400px' }}>
        {session.status === 'running' ? (
          <Terminal
            sessionId={id}
            isConnected={isConnected}
            onSendInput={handleSendInput}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full rounded-lg border border-[#1e1e2e] bg-[#111118]">
            <div className="text-gray-600 text-sm mb-2">Session is {session.status}</div>
            <p className="text-xs text-gray-600">
              Stopped {formatRelativeTime(session.stoppedAt)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
