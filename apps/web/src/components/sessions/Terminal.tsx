'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string
  isConnected?: boolean
  onSendInput?: (data: string) => void
}

async function loadXterm(): Promise<{
  Terminal: typeof XTermTerminal
  FitAddon: typeof XTermFitAddon
} | null> {
  try {
    const [xtermMod, fitMod] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ])
    return { Terminal: xtermMod.Terminal, FitAddon: fitMod.FitAddon }
  } catch {
    return null
  }
}

// Stub terminal rendered when xterm.js is not installed
function StubTerminalContent({ sessionId }: { sessionId: string }) {
  return (
    <div className="h-full overflow-y-auto p-4 font-mono text-sm text-green-400 leading-relaxed">
      <div className="text-purple-400 mb-2">SessionForge Terminal — Session {sessionId}</div>
      <div className="text-gray-500 mb-1">
        Install xterm.js to enable live terminal:
      </div>
      <div className="text-purple-300 mb-4">
        npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
      </div>
      <div className="text-gray-300">$ claude</div>
      <div className="text-gray-500">Connecting to Claude Code session...</div>
      <div className="text-green-400">Connected. Session active.</div>
      <div className="text-gray-300">
        $ <span className="animate-pulse">|</span>
      </div>
    </div>
  )
}

export function Terminal({ sessionId, isConnected = false, onSendInput }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitAddonRef = useRef<XTermFitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [xtermFailed, setXtermFailed] = useState(false)
  const stubRef = useRef(false)

  const connectWebSocket = useCallback(() => {
    try {
      // Use same-origin WS — relative URL converted to ws(s):// automatically
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${proto}//${window.location.host}/api/ws/dashboard`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe_session', sessionId }))
        terminalRef.current?.write('\r\n\x1b[32mConnected to session\x1b[0m\r\n')
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string)
          if (msg.type === 'session_output' && msg.sessionId === sessionId) {
            // STUB: Real output is base64 encoded PTY data
            const data = atob(msg.data as string)
            terminalRef.current?.write(data)
          }
        } catch {
          terminalRef.current?.write(event.data as string)
        }
      }

      ws.onclose = () => {
        terminalRef.current?.write('\r\n\x1b[33mConnection closed. Reconnecting...\x1b[0m\r\n')
        toast.warning('Terminal disconnected — reconnecting...')
        setTimeout(connectWebSocket, 3000)
      }

      ws.onerror = () => {
        // error always followed by close
      }
    } catch {
      // Demo mode when no WS server
      setTimeout(() => {
        if (terminalRef.current) {
          terminalRef.current.write('\x1b[33m[DEMO MODE]\x1b[0m No WebSocket server detected.\r\n')
          terminalRef.current.write('\x1b[36mSessionForge Terminal\x1b[0m v1.0.0\r\n')
          terminalRef.current.write('$ \x1b[32mclaude\x1b[0m\r\n')
          terminalRef.current.write('\x1b[90m> Analyzing your codebase...\x1b[0m\r\n')
          terminalRef.current.write('\x1b[90m> Ready for input.\x1b[0m\r\n$ ')
        }
      }, 500)
    }
  }, [sessionId])

  useEffect(() => {
    if (!containerRef.current) return

    let mounted = true
    const container = containerRef.current

    loadXterm().then((mods) => {
      if (!mounted || !container) return

      if (!mods) {
        stubRef.current = true
        setXtermFailed(true)
        return
      }

      const { Terminal: XTerm, FitAddon } = mods

      const terminal = new XTerm({
        theme: {
          background: '#0a0a0f',
          foreground: '#e2e8f0',
          cursor: '#8B5CF6',
          cursorAccent: '#0a0a0f',
          black: '#1e1e2e',
          red: '#f38ba8',
          green: '#4ade80',
          yellow: '#f9e2af',
          blue: '#89b4fa',
          magenta: '#cba6f7',
          cyan: '#94e2d5',
          white: '#cdd6f4',
          brightBlack: '#585b70',
          brightRed: '#f38ba8',
          brightGreen: '#a6e3a1',
          brightYellow: '#f9e2af',
          brightBlue: '#89b4fa',
          brightMagenta: '#cba6f7',
          brightCyan: '#94e2d5',
          brightWhite: '#ffffff',
        },
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.5,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        allowProposedApi: true,
      })

      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.open(container)
      fitAddon.fit()

      terminalRef.current = terminal
      fitAddonRef.current = fitAddon

      // Handle keyboard input — send to WS
      terminal.onData((data) => {
        if (onSendInput) onSendInput(data)
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'session_input',
              sessionId,
              data: btoa(data), // base64 encode PTY input
            })
          )
        }
      })

      // Handle resize with ResizeObserver + fit addon
      const observer = new ResizeObserver(() => {
        fitAddon.fit()
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({ type: 'resize', sessionId, cols: terminal.cols, rows: terminal.rows })
          )
        }
      })
      observer.observe(container)
      observerRef.current = observer

      // Initial greeting
      terminal.write(`\x1b[90mSessionForge Terminal — Session ID: ${sessionId}\x1b[0m\r\n`)
      terminal.write(`\x1b[90m${'─'.repeat(60)}\x1b[0m\r\n`)
      terminal.focus()

      connectWebSocket()
    })

    return () => {
      mounted = false
      observerRef.current?.disconnect()
      terminalRef.current?.dispose()
      wsRef.current?.close()
    }
  }, [sessionId, connectWebSocket, onSendInput])

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden rounded-lg bg-[#0a0a0f] border border-[#1e1e2e]">
      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-[#1e1e2e] px-3 py-1.5 bg-[#0a0a0f] shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-500/60" />
            <div className="h-3 w-3 rounded-full bg-yellow-500/60" />
            <div className="h-3 w-3 rounded-full bg-green-500/60" />
          </div>
          <span className="text-xs text-gray-600 font-mono">bash — SessionForge</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-600'
            }`}
          />
          <span className="text-xs text-gray-600">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Terminal render area */}
      {xtermFailed ? (
        <div className="flex-1 min-h-0 w-full overflow-y-auto">
          <StubTerminalContent sessionId={sessionId} />
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 min-h-0 w-full p-1" />
      )}
    </div>
  )
}
