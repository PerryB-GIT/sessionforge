import { pgTable, uuid, varchar, timestamp, integer, boolean, real, text, primaryKey } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  name: varchar('name', { length: 255 }),
  plan: varchar('plan', { length: 50 }).notNull().default('free'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  plan: varchar('plan', { length: 50 }).notNull().default('free'),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const orgMembers = pgTable('org_members', {
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: varchar('role', { length: 50 }).notNull().default('member'),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.orgId, t.userId] }),
}))

export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  orgId: uuid('org_id').references(() => organizations.id),
  name: varchar('name', { length: 255 }).notNull(),
  agentToken: varchar('agent_token', { length: 255 }).notNull().unique(),
  os: varchar('os', { length: 50 }),
  hostname: varchar('hostname', { length: 255 }),
  agentVersion: varchar('agent_version', { length: 50 }),
  status: varchar('status', { length: 50 }).notNull().default('offline'),
  lastSeen: timestamp('last_seen'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').notNull().references(() => machines.id),
  pid: integer('pid'),
  processName: varchar('process_name', { length: 255 }).notNull().default('claude'),
  workdir: varchar('workdir', { length: 1024 }),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  stoppedAt: timestamp('stopped_at'),
  status: varchar('status', { length: 50 }).notNull().default('running'),
  peakMemoryMb: real('peak_memory_mb'),
  avgCpuPercent: real('avg_cpu_percent'),
})

export const sessionMetrics = pgTable('session_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  memoryMb: real('memory_mb'),
  cpuPercent: real('cpu_percent'),
})

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  scopes: varchar('scopes', { length: 500 }).notNull().default('agent'),
  lastUsed: timestamp('last_used'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  invitedEmail: varchar('invited_email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('member'),
  token: varchar('token', { length: 255 }).notNull().unique(),
  invitedById: uuid('invited_by_id').notNull().references(() => users.id),
  acceptedAt: timestamp('accepted_at'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }),
  resourceId: varchar('resource_id', { length: 255 }),
  metadata: text('metadata'), // JSON string
  ipAddress: varchar('ip_address', { length: 50 }),
  userAgent: varchar('user_agent', { length: 500 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
