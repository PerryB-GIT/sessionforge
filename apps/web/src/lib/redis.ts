import { Redis } from '@upstash/redis'

// STUB: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in environment
// For local development, you can use Upstash free tier or a local Redis instance
// via the ioredis adapter: https://docs.upstash.com/redis/sdks/ioredis

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | undefined
}

function createRedisClient(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

function getRedisInstance(): Redis {
  if (process.env.NODE_ENV === 'production') {
    return createRedisClient()
  }
  if (!global.__redisClient) {
    global.__redisClient = createRedisClient()
  }
  return global.__redisClient
}

// Lazy proxy — no Redis client created at module load time.
// Initialization happens on first property access (first actual use).
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return getRedisInstance()[prop as keyof Redis]
  },
})

// ─── Key Helpers ───────────────────────────────────────────────────────────────

export const RedisKeys = {
  /** Channel for broadcasting to browser dashboard WebSocket subscribers */
  dashboardChannel: (userId: string) => `dashboard:${userId}`,

  /** Channel for sending commands to a specific agent */
  agentChannel: (machineId: string) => `agent:${machineId}`,

  /** Circular buffer of session PTY output (last N lines) */
  sessionLogs: (sessionId: string) => `session:logs:${sessionId}`,

  /** Set of WebSocket connection IDs subscribed to a session's output */
  sessionSubscribers: (sessionId: string) => `session:subs:${sessionId}`,

  /** Machine heartbeat metrics cache */
  machineMetrics: (machineId: string) => `machine:metrics:${machineId}`,

  /** Connection ID → machine ID mapping for agent WebSockets */
  agentConnections: () => `agent:connections`,
} as const

export const SESSION_LOG_MAX_LINES = 2000
export const SESSION_LOG_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days
