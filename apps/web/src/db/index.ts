import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Cloud SQL unix socket URLs use the format:
//   postgresql://user:pass@/dbname?host=/cloudsql/project:region:instance
// postgres-js v3 uses new URL() internally which rejects empty-host URLs,
// so we parse the components manually and pass them as connection options.
function buildPostgresClient(connectionString: string, max: number) {
  const hostMatch = connectionString.match(/[?&]host=([^&]+)/)
  if (hostMatch) {
    const socketPath = decodeURIComponent(hostMatch[1])
    const credMatch = connectionString.match(/^postgresql?:\/\/([^:]+):([^@]+)@\/([^?]+)/)
    if (credMatch) {
      const [, user, password, database] = credMatch
      return postgres({
        host: socketPath,
        user: decodeURIComponent(user),
        password: decodeURIComponent(password),
        database,
        max,
      })
    }
  }
  return postgres(connectionString, { max })
}

// Singleton pattern to avoid multiple connections in Next.js dev (hot reload)
declare global {
  // eslint-disable-next-line no-var
  var __pgClient: ReturnType<typeof postgres> | undefined
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof drizzle> | undefined
}

function createDb() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return null

  let client: ReturnType<typeof postgres>
  if (process.env.NODE_ENV === 'production') {
    client = buildPostgresClient(connectionString, 10)
  } else {
    if (!global.__pgClient) {
      global.__pgClient = buildPostgresClient(connectionString, 5)
    }
    client = global.__pgClient
  }
  return drizzle(client, { schema })
}

// Lazily initialized — null at build time, real instance at runtime
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_db) {
    const instance = createDb()
    if (!instance) throw new Error('[db] DATABASE_URL is not set')
    _db = instance as ReturnType<typeof drizzle<typeof schema>>
  }
  return _db
}

// Proxy so existing code using `db.select(...)` etc. works unchanged at runtime
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    const d = getDb()
    const val = Reflect.get(d, prop, receiver)
    return typeof val === 'function' ? val.bind(d) : val
  },
})

// For DrizzleAdapter which needs the real drizzle instance (not a Proxy)
export { getDb as getRealDb }

// Re-export all schema tables for convenience
export * from './schema'
