/**
 * WebSocket test helpers
 *
 * Provides a lightweight mock WebSocket server (using the 'ws' npm package)
 * so integration tests can simulate agent connections without needing the
 * full Next.js runtime.
 *
 * Also exports helper functions to send typed messages and capture responses.
 */

import { WebSocket, WebSocketServer } from 'ws'
import type { AgentMessage, CloudToAgentMessage } from '@sessionforge/shared-types'

// ---------------------------------------------------------------------------
// Mock WebSocket Server
// ---------------------------------------------------------------------------

export interface MockWsServer {
  /** The underlying ws.WebSocketServer instance */
  server: WebSocketServer
  /** All messages received from clients since the server started */
  receivedMessages: AgentMessage[]
  /** All messages sent to clients (from the server side) */
  sentMessages: CloudToAgentMessage[]
  /** Connected client sockets */
  clients: WebSocket[]
  /** Send a message to all connected clients */
  broadcast: (msg: CloudToAgentMessage) => void
  /** Send a message to the first connected client */
  sendToFirst: (msg: CloudToAgentMessage) => void
  /** Wait until at least N messages have been received */
  waitForMessages: (count: number, timeout?: number) => Promise<void>
  /** Gracefully close the server and all connections */
  close: () => Promise<void>
}

/**
 * Start a mock WebSocket server on a random available port.
 *
 * @param onMessage - Optional callback invoked for every message received
 *                    from a connected agent client.
 */
export async function createMockWsServer(
  onMessage?: (msg: AgentMessage, socket: WebSocket) => void
): Promise<MockWsServer> {
  const receivedMessages: AgentMessage[] = []
  const sentMessages: CloudToAgentMessage[] = []
  const clients: WebSocket[] = []

  const wss = new WebSocketServer({ port: 0 }) // port 0 = OS picks a free port

  wss.on('connection', (socket) => {
    clients.push(socket)

    socket.on('message', (raw) => {
      let parsed: AgentMessage
      try {
        parsed = JSON.parse(raw.toString()) as AgentMessage
      } catch {
        return // ignore malformed frames
      }
      receivedMessages.push(parsed)
      onMessage?.(parsed, socket)
    })

    socket.on('close', () => {
      const idx = clients.indexOf(socket)
      if (idx !== -1) clients.splice(idx, 1)
    })
  })

  // Wait for the server to be listening
  await new Promise<void>((resolve) => {
    if (wss.address()) resolve()
    else wss.once('listening', resolve)
  })

  const broadcast = (msg: CloudToAgentMessage) => {
    const frame = JSON.stringify(msg)
    sentMessages.push(msg)
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame)
    }
  }

  const sendToFirst = (msg: CloudToAgentMessage) => {
    if (clients.length === 0) throw new Error('No clients connected to mock WS server')
    sentMessages.push(msg)
    clients[0].send(JSON.stringify(msg))
  }

  const waitForMessages = (count: number, timeout = 5000): Promise<void> =>
    new Promise((resolve, reject) => {
      if (receivedMessages.length >= count) return resolve()
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${count} messages (got ${receivedMessages.length})`)),
        timeout
      )
      const interval = setInterval(() => {
        if (receivedMessages.length >= count) {
          clearInterval(interval)
          clearTimeout(timer)
          resolve()
        }
      }, 50)
    })

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      // Close all open client sockets first
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.terminate()
      }
      wss.close((err) => (err ? reject(err) : resolve()))
    })

  return { server: wss, receivedMessages, sentMessages, clients, broadcast, sendToFirst, waitForMessages, close }
}

// ---------------------------------------------------------------------------
// Mock Agent Client
// ---------------------------------------------------------------------------

export interface MockAgentClient {
  socket: WebSocket
  receivedMessages: CloudToAgentMessage[]
  send: (msg: AgentMessage) => void
  waitForMessage: (type: CloudToAgentMessage['type'], timeout?: number) => Promise<CloudToAgentMessage>
  close: () => Promise<void>
}

/**
 * Create a mock agent client that connects to a given WebSocket URL.
 * Optionally pass headers (e.g. Authorization) to simulate API-key auth.
 */
export async function createMockAgentClient(
  url: string,
  headers: Record<string, string> = {}
): Promise<MockAgentClient> {
  const receivedMessages: CloudToAgentMessage[] = []

  const socket = new WebSocket(url, { headers })

  // Wait for the connection to open (or fail)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

  socket.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as CloudToAgentMessage
      receivedMessages.push(parsed)
    } catch {
      // ignore malformed frames
    }
  })

  const send = (msg: AgentMessage) => {
    socket.send(JSON.stringify(msg))
  }

  const waitForMessage = (
    type: CloudToAgentMessage['type'],
    timeout = 5000
  ): Promise<CloudToAgentMessage> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for message type '${type}'`)),
        timeout
      )
      const check = () => {
        const found = receivedMessages.find((m) => m.type === type)
        if (found) {
          clearTimeout(timer)
          clearInterval(interval)
          resolve(found)
        }
      }
      const interval = setInterval(check, 50)
      check() // check immediately in case message arrived before interval starts
    })

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) return resolve()
      socket.once('close', resolve)
      socket.close()
    })

  return { socket, receivedMessages, send, waitForMessage, close }
}

// ---------------------------------------------------------------------------
// Address helper
// ---------------------------------------------------------------------------

/**
 * Get the ws:// URL from a running MockWsServer.
 */
export function getMockWsUrl(server: MockWsServer): string {
  const addr = server.server.address() as { port: number }
  return `ws://localhost:${addr.port}`
}
