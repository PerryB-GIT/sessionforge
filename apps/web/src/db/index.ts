import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// STUB: DATABASE_URL must be set in environment (e.g. postgresql://user:pass@host:5432/sessionforge)
const connectionString = process.env.DATABASE_URL!

// Use a singleton pattern to avoid multiple connections in Next.js dev (hot reload)
declare global {
  // eslint-disable-next-line no-var
  var __pgClient: ReturnType<typeof postgres> | undefined
}

let client: ReturnType<typeof postgres>

if (process.env.NODE_ENV === 'production') {
  client = postgres(connectionString, { max: 10 })
} else {
  if (!global.__pgClient) {
    global.__pgClient = postgres(connectionString, { max: 5 })
  }
  client = global.__pgClient
}

export const db = drizzle(client, { schema })

// Re-export all schema tables for convenience
export * from './schema'
