'use client'

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'
const RECONNECT_DELAY = 3000
const MAX_RECONNECT_ATTEMPTS = 5

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const { setWsStatus, updateMachine, updateSession } = useStore()

  const connect = useCallback(() => {
    // STUB: Replace with real auth token from session
    const token = 'stub-auth-token'

    setWsStatus('connecting')

    try {
      // STUB: Real WebSocket URL would be /api/ws/dashboard with auth cookie
      const ws = new WebSocket(`${WS_URL}/api/ws/dashboard?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0
        setWsStatus('connected')
        toast.success('Connected to SessionForge', { duration: 2000 })
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
          toast.warning(`Connection lost. Reconnecting... (${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`)
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
      // In development/stub mode, simulate connected state
      setWsStatus('connected')
    }
  }, [setWsStatus, updateMachine, updateSession])

  function handleMessage(message: { type: string; [key: string]: unknown }) {
    switch (message.type) {
      case 'machine_updated': {
        const m = message.machine as { id: string; status: string; cpu: number; memory: number }
        updateMachine(m.id, {
          status: m.status as 'online' | 'offline' | 'error',
          cpu: m.cpu,
          memory: m.memory,
        })
        break
      }
      case 'session_updated': {
        const s = message.session as { id: string; status: string; machineId: string }
        updateSession(s.id, {
          status: s.status as 'running' | 'stopped' | 'crashed' | 'paused',
        })
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
    // STUB: Simulate connected state in development instead of real WS
    setWsStatus('connected')

    return () => {
      disconnect()
    }
  }, [])

  return { sendMessage, wsStatus: useStore((s) => s.wsStatus) }
}
