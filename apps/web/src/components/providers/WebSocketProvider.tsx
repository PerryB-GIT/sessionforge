'use client'

import { createContext, useContext, ReactNode } from 'react'
import { useWebSocket } from '@/hooks/useWebSocket'

interface WebSocketContextValue {
  sendMessage: (data: unknown) => void
  wsStatus: import('@/store').WsStatus
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket()
  return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>
}

export function useWs(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext)
  if (!ctx) throw new Error('useWs must be used inside WebSocketProvider')
  return ctx
}
