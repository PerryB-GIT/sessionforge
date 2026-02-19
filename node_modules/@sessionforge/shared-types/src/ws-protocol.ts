// Messages FROM agent TO cloud
export type AgentMessage =
  | { type: 'heartbeat'; machineId: string; cpu: number; memory: number; disk: number; sessionCount: number }
  | { type: 'session_started'; session: { id: string; pid: number; processName: string; workdir: string; startedAt: string } }
  | { type: 'session_stopped'; sessionId: string; exitCode: number | null }
  | { type: 'session_crashed'; sessionId: string; error: string }
  | { type: 'session_output'; sessionId: string; data: string } // base64 encoded PTY output
  | { type: 'register'; machineId: string; name: string; os: string; hostname: string; version: string }

// Messages FROM cloud TO agent
export type CloudToAgentMessage =
  | { type: 'start_session'; requestId: string; command: string; workdir: string; env?: Record<string, string> }
  | { type: 'stop_session'; sessionId: string; force?: boolean }
  | { type: 'pause_session'; sessionId: string }
  | { type: 'resume_session'; sessionId: string }
  | { type: 'session_input'; sessionId: string; data: string } // base64 encoded input
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'ping' }

// Messages FROM cloud TO browser dashboard
export type CloudToBrowserMessage =
  | { type: 'machine_updated'; machine: { id: string; status: string; cpu: number; memory: number } }
  | { type: 'session_updated'; session: { id: string; status: string; machineId: string } }
  | { type: 'session_output'; sessionId: string; data: string }
  | { type: 'alert_fired'; alertId: string; message: string; severity: 'info' | 'warning' | 'critical' }
  | { type: 'pong' }
