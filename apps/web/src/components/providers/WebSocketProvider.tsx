'use client'

import { createContext, useContext, ReactNode } from 'react'
import { useWebSocket, registerSessionOutputListener } from '@/hooks/useWebSocket'
import { useMachines } from '@/hooks/useMachines'

interface WebSocketContextValue {
  sendMessage: (data: unknown) => void
  subscribeSession: (sessionId: string) => void
  registerSessionOutputListener: typeof registerSessionOutputListener
  wsStatus: import('@/store').WsStatus
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket()
  // Pre-fetch machines at the layout level so StartSessionDialog always has
  // online machines available regardless of which page the user navigates to first.
  useMachines()
  return (
    <WebSocketContext.Provider value={{ ...ws, registerSessionOutputListener }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWs(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext)
  if (!ctx) throw new Error('useWs must be used inside WebSocketProvider')
  return ctx
}
