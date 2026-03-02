'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Square, Monitor, Clock, Cpu, MemoryStick, Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SessionStatusBadge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Terminal, type TerminalHandle } from '@/components/sessions/Terminal'
import { AsciinemaPlayerLoader } from '@/components/sessions/AsciinemaPlayerLoader'
import { useSession } from '@/hooks/useSessions'
import { useStore } from '@/store'
import { useMachine } from '@/hooks/useMachines'
import { useWebSocket } from '@/hooks/useWebSocket'
import { formatDuration, formatRelativeTime, truncate } from '@/lib/utils'
import { toast } from 'sonner'

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { session, isLoading } = useSession(id)
  const updateSession = useStore((s) => s.updateSession)
  const { sendMessage, wsStatus } = useWebSocket()

  const [isStopping, setIsStopping] = useState(false)
  const [activeTab, setActiveTab] = useState('terminal')

  // Historical log state (stopped sessions)
  const [historicalLogs, setHistoricalLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)

  // Recording state
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordingLoading, setRecordingLoading] = useState(false)
  const [recordingError, setRecordingError] = useState<string | null>(null)

  const terminalRef = useRef<TerminalHandle>(null)

  const { machine } = useMachine(session?.machineId ?? '')
  const isConnected = wsStatus === 'connected'
  const isRunning = session?.status === 'running'

  // Fetch historical logs when session is stopped
  useEffect(() => {
    if (!session || session.status === 'running') return
    setLogsLoading(true)
    setLogsError(null)
    fetch(`/api/sessions/${id}/logs?limit=500`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data?.lines) {
          setHistoricalLogs(
            (json.data.lines as string[]).map((l) => {
              try {
                return atob(l)
              } catch {
                return l
              }
            })
          )
        } else if (json.error?.code === 'HISTORY_LIMIT') {
          setLogsError(json.error.message as string)
        } else {
          setHistoricalLogs([])
        }
      })
      .catch(() => setLogsError('Failed to load session logs'))
      .finally(() => setLogsLoading(false))
  }, [id, session?.status])

  // Fetch recording URL when recording tab is selected and session is stopped
  useEffect(() => {
    if (activeTab !== 'recording' || !session || session.status === 'running') return
    if (recordingUrl || recordingError || recordingLoading) return
    setRecordingLoading(true)
    fetch(`/api/sessions/${id}/recording`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data?.url) {
          setRecordingUrl(json.data.url as string)
        } else {
          setRecordingError((json.error?.message as string) ?? 'Recording not available')
        }
      })
      .catch(() => setRecordingError('Failed to load recording'))
      .finally(() => setRecordingLoading(false))
  }, [activeTab, id, session?.status, recordingUrl, recordingError, recordingLoading])

  function handleSendInput(data: string) {
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
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to stop session')
        return
      }
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
          <div className="text-sm font-semibold text-white truncate">{session.processName}</div>
          {session.workdir && (
            <span className="text-xs text-gray-500 font-mono hidden sm:block">
              {truncate(session.workdir, 40)}
            </span>
          )}
          <SessionStatusBadge status={session.status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunning && (
            <Button variant="destructive" size="sm" onClick={stopSession} isLoading={isStopping}>
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
        </div>
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
            <Clock className="h-4 w-4 text-purple-400 shrink-0" />
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
              <p className="text-xs text-gray-500">{isRunning ? 'Live CPU' : 'Avg CPU'}</p>
              <p className="text-sm text-white">
                {isRunning
                  ? machine?.cpu !== undefined
                    ? `${machine.cpu}%`
                    : '—'
                  : session.avgCpuPercent !== null
                    ? `${session.avgCpuPercent}%`
                    : '—'}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <MemoryStick className="h-4 w-4 text-purple-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">{isRunning ? 'Live Memory' : 'Peak Memory'}</p>
              <p className="text-sm text-white">
                {isRunning
                  ? machine?.memory !== undefined
                    ? `${machine.memory}%`
                    : '—'
                  : session.peakMemoryMb !== null
                    ? `${session.peakMemoryMb} MB`
                    : '—'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Terminal */}
      <div className="flex flex-1 min-h-0 gap-0" style={{ minHeight: '400px' }}>
        <div className="w-full flex flex-col min-h-0">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col flex-1 min-h-0"
          >
            <TabsList className="shrink-0 self-start mb-0">
              <TabsTrigger value="terminal">Terminal</TabsTrigger>
              <TabsTrigger value="recording">
                <Film className="h-3 w-3 mr-1" />
                Recording
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="terminal"
              className="flex-1 min-h-0 mt-2 data-[state=inactive]:hidden"
            >
              {isRunning ? (
                <Terminal sessionId={id} isConnected={isConnected} onSendInput={handleSendInput} />
              ) : logsLoading ? (
                <div className="h-full rounded-lg border border-[#1e1e2e] bg-[#111118] animate-pulse" />
              ) : logsError ? (
                <div className="flex flex-col items-center justify-center h-full rounded-lg border border-[#1e1e2e] bg-[#111118]">
                  <p className="text-gray-400 text-sm mb-1">Session logs unavailable</p>
                  <p className="text-gray-600 text-xs">{logsError}</p>
                </div>
              ) : historicalLogs.length > 0 ? (
                <Terminal ref={terminalRef} sessionId={id} readOnly initialLogs={historicalLogs} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full rounded-lg border border-[#1e1e2e] bg-[#111118]">
                  <div className="text-gray-600 text-sm mb-2">Session is {session.status}</div>
                  <p className="text-xs text-gray-600">
                    Stopped {formatRelativeTime(session.stoppedAt)}
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent
              value="recording"
              className="flex-1 min-h-0 mt-2 data-[state=inactive]:hidden"
            >
              <div className="flex flex-col h-full rounded-lg border border-[#1e1e2e] bg-[#111118] overflow-hidden">
                {isRunning ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <Film className="h-8 w-8 text-gray-600" />
                    <p className="text-gray-500 text-sm">Recording available after session stops</p>
                  </div>
                ) : recordingLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="h-6 w-6 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                  </div>
                ) : recordingUrl ? (
                  <AsciinemaPlayerLoader url={recordingUrl} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                    <Film className="h-10 w-10 text-gray-600" />
                    <div>
                      <p className="text-gray-400 text-sm font-medium mb-1">Session Recording</p>
                      <p className="text-gray-600 text-xs">
                        {recordingError ?? 'Recording requires Enterprise plan'}
                      </p>
                    </div>
                    <Link href="/settings/billing">
                      <Button variant="outline" size="sm">
                        Upgrade to Enterprise
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
