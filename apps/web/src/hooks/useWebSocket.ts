'use client'

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'

const RECONNECT_DELAY = 3000
const MAX_RECONNECT_ATTEMPTS = 5

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const wasConnectedRef = useRef(false)
  const { setWsStatus, updateMachine, updateSession } = useStore()

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
    connect()

    return () => {
      disconnect()
    }
  }, [])

  return { sendMessage, wsStatus: useStore((s) => s.wsStatus) }
}
