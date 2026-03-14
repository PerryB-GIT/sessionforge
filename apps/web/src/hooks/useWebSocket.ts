'use client'

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'

const RECONNECT_DELAY = 3000
const MAX_RECONNECT_ATTEMPTS = 5

// Session output listeners: sessionId → Set of callbacks
type OutputListener = (data: string) => void
const sessionOutputListeners = new Map<string, Set<OutputListener>>()

export function registerSessionOutputListener(sessionId: string, cb: OutputListener) {
  if (!sessionOutputListeners.has(sessionId)) {
    sessionOutputListeners.set(sessionId, new Set())
  }
  sessionOutputListeners.get(sessionId)!.add(cb)
  return () => {
    sessionOutputListeners.get(sessionId)?.delete(cb)
  }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const wasConnectedRef = useRef(false)
  const subscribedSessionsRef = useRef<Set<string>>(new Set())
  const { setWsStatus, updateMachine, updateSession } = useStore()

  const sendRaw = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  const subscribeSession = useCallback(
    (sessionId: string) => {
      // Always send subscribe_session — the server's ring buffer replay is idempotent.
      // Do NOT skip if already in the set: navigating away and back remounts the Terminal
      // which needs a fresh replay even though the WS connection is still alive.
      subscribedSessionsRef.current.add(sessionId)
      sendRaw({ type: 'subscribe_session', sessionId })
    },
    [sendRaw]
  )

  const connect = useCallback(() => {
    setWsStatus('connecting')

    try {
      // Same-origin WS — session cookie sent automatically by browser
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/api/ws/dashboard`)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0
        setWsStatus('connected')
        // Only show reconnection success toast, not the initial connect
        if (wasConnectedRef.current) {
          toast.success('Reconnected to SessionForge', { duration: 2000 })
        }
        wasConnectedRef.current = true
        // Re-subscribe to any active sessions after reconnect
        for (const sessionId of subscribedSessionsRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe_session', sessionId }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string)
          handleMessage(message)
        } catch {
          console.warn('Failed to parse WebSocket message:', event.data)
        }
      }

      ws.onclose = () => {
        setWsStatus('disconnected')
        wsRef.current = null

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++
          // Only show one warning on first drop, not on every retry
          if (reconnectAttemptsRef.current === 1) {
            toast.warning('Connection lost — reconnecting...')
          }
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY)
        } else {
          toast.error('Connection failed. Please refresh the page.')
        }
      }

      ws.onerror = () => {
        // onerror is always followed by onclose, so just log
        console.warn('WebSocket error occurred')
      }
    } catch (err) {
      console.warn('WebSocket not available in this environment:', err)
      setWsStatus('disconnected')
    }
  }, [setWsStatus, updateMachine, updateSession])

  function handleMessage(message: { type: string; [key: string]: unknown }) {
    switch (message.type) {
      case 'session_output': {
        const { sessionId, data } = message as unknown as { sessionId: string; data: string }
        const listeners = sessionOutputListeners.get(sessionId)
        if (listeners) {
          for (const cb of listeners) cb(data)
        }
        break
      }
      case 'machine_updated': {
        const m = message.machine as {
          id: string
          status: string
          cpu: number
          memory: number
          disk: number
          sessionCount: number
          discoveredProcesses?: import('@/store').DiscoveredProcess[]
        }
        const knownIds = useStore.getState().machines.map((x) => x.id)
        if (!knownIds.includes(m.id)) {
          // Machine not in store yet — fetch full list so it appears in the UI
          fetch('/api/machines')
            .then((r) => r.json())
            .then((json) => {
              if (json.data?.items) {
                const list = json.data.items.map(
                  (x: {
                    id: string
                    userId: string
                    orgId: string | null
                    name: string
                    os: string
                    hostname: string
                    status: string
                    lastSeen: string | null
                    agentVersion: string | null
                    createdAt: string
                  }) => ({
                    id: x.id,
                    userId: x.userId,
                    orgId: x.orgId,
                    name: x.name,
                    os: x.os,
                    hostname: x.hostname,
                    status: x.status,
                    lastSeen: x.lastSeen ? new Date(x.lastSeen) : null,
                    agentVersion: x.agentVersion ?? null,
                    createdAt: new Date(x.createdAt),
                  })
                )
                useStore.getState().setMachines(list)
              }
            })
            .catch(() => {})
        }
        updateMachine(m.id, {
          status: m.status as 'online' | 'offline' | 'error',
          cpu: m.cpu,
          memory: m.memory,
          disk: m.disk,
          sessionCount: m.sessionCount,
          discoveredProcesses: m.discoveredProcesses,
        })
        break
      }
      case 'session_updated': {
        const s = message.session as { id: string; status: string; machineId: string }
        const knownSessionIds = useStore.getState().sessions.map((x) => x.id)
        if (!knownSessionIds.includes(s.id)) {
          // New session not yet in the store — refresh the full sessions list.
          fetch('/api/sessions')
            .then((r) => r.json())
            .then((json) => {
              if (json.data?.items) {
                useStore.getState().setSessions(
                  json.data.items.map(
                    (x: {
                      id: string
                      machineId: string
                      pid: number | null
                      processName: string
                      workdir: string | null
                      status: string
                      startedAt: string
                      stoppedAt: string | null
                      peakMemoryMb: number | null
                      avgCpuPercent: number | null
                    }) => ({
                      id: x.id,
                      machineId: x.machineId,
                      pid: x.pid,
                      processName: x.processName,
                      workdir: x.workdir,
                      status: x.status,
                      startedAt: new Date(x.startedAt),
                      stoppedAt: x.stoppedAt ? new Date(x.stoppedAt) : null,
                      peakMemoryMb: x.peakMemoryMb,
                      avgCpuPercent: x.avgCpuPercent,
                    })
                  )
                )
              }
            })
            .catch(() => {})
        } else {
          updateSession(s.id, {
            status: s.status as 'running' | 'stopped' | 'crashed' | 'paused',
          })
          // Re-fetch stopped/crashed sessions to pick up claudeConversationId
          // (the WS message only carries status, not the full record).
          if (s.status === 'stopped' || s.status === 'crashed') {
            fetch(`/api/sessions/${s.id}`)
              .then((r) => r.json())
              .then((json) => {
                if (json.data) {
                  const x = json.data
                  updateSession(s.id, {
                    claudeConversationId: x.claudeConversationId ?? null,
                    stoppedAt: x.stoppedAt ? new Date(x.stoppedAt) : null,
                    peakMemoryMb: x.peakMemoryMb ?? null,
                    avgCpuPercent: x.avgCpuPercent ?? null,
                  })
                }
              })
              .catch(() => {})
          }
        }
        break
      }
      case 'alert_fired': {
        const severity = message.severity as string
        const msg = message.message as string
        if (severity === 'critical') toast.error(msg)
        else if (severity === 'warning') toast.warning(msg)
        else toast.info(msg)
        break
      }
      default:
        break
    }
  }

  const sendMessage = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
    }
    wsRef.current?.close()
    wsRef.current = null
    setWsStatus('disconnected')
  }, [setWsStatus])

  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, [])

  return { sendMessage, subscribeSession, wsStatus: useStore((s) => s.wsStatus) }
}
