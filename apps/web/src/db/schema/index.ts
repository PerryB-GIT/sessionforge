import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  real,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// ─── Support Ticket Enums ─────────────────────────────────────────────────────

export const supportTicketStatusEnum = pgEnum('support_ticket_status', [
  'pending',
  'approved',
  'rejected',
  'closed',
])

// ─── Enums ────────────────────────────────────────────────────────────────────

export const planEnum = pgEnum('plan', ['free', 'pro', 'team', 'enterprise'])
export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'member', 'viewer'])
export const machineOsEnum = pgEnum('machine_os', ['windows', 'macos', 'linux'])
export const machineStatusEnum = pgEnum('machine_status', ['online', 'offline', 'error'])
export const sessionStatusEnum = pgEnum('session_status', ['running', 'stopped', 'crashed', 'paused'])

// ─── Users ─────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash'),
  name: varchar('name', { length: 255 }),
  plan: planEnum('plan').notNull().default('free'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Organizations ─────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  plan: planEnum('plan').notNull().default('free'),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Org Members ───────────────────────────────────────────────────────────────

export const orgMembers = pgTable('org_members', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: memberRoleEnum('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Machines ──────────────────────────────────────────────────────────────────

export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  os: machineOsEnum('os').notNull(),
  hostname: varchar('hostname', { length: 255 }).notNull(),
  agentVersion: varchar('agent_version', { length: 64 }).notNull().default('0.0.0'),
  status: machineStatusEnum('status').notNull().default('offline'),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  ipAddress: varchar('ip_address', { length: 45 }),
  cpuModel: varchar('cpu_model', { length: 255 }),
  ramGb: real('ram_gb'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Sessions ──────────────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  machineId: uuid('machine_id').notNull().references(() => machines.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  pid: integer('pid'),
  processName: varchar('process_name', { length: 255 }).notNull().default('claude'),
  workdir: text('workdir'),
  status: sessionStatusEnum('status').notNull().default('running'),
  exitCode: integer('exit_code'),
  peakMemoryMb: real('peak_memory_mb'),
  avgCpuPercent: real('avg_cpu_percent'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── API Keys ──────────────────────────────────────────────────────────────────

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 8 }).notNull(),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Auth: Verification Tokens (NextAuth) ──────────────────────────────────────

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => ({
    compositeKey: uniqueIndex('verification_tokens_identifier_token_key').on(
      table.identifier,
      table.token
    ),
  })
)

// ─── Auth: Sessions (NextAuth) ────────────────────────────────────────────────

export const authSessions = pgTable('sessions_auth', {
  sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
})

// ─── Password Reset Tokens ─────────────────────────────────────────────────────

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Relations ─────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  organizations: many(orgMembers),
  machines: many(machines),
  sessions: many(sessions),
  apiKeys: many(apiKeys),
  authSessions: many(authSessions),
  passwordResetTokens: many(passwordResetTokens),
}))

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner: one(users, { fields: [organizations.ownerId], references: [users.id] }),
  members: many(orgMembers),
  machines: many(machines),
  apiKeys: many(apiKeys),
}))

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  org: one(organizations, { fields: [orgMembers.orgId], references: [organizations.id] }),
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
}))

export const machinesRelations = relations(machines, ({ one, many }) => ({
  user: one(users, { fields: [machines.userId], references: [users.id] }),
  org: one(organizations, { fields: [machines.orgId], references: [organizations.id] }),
  sessions: many(sessions),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  machine: one(machines, { fields: [sessions.machineId], references: [machines.id] }),
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
  org: one(organizations, { fields: [apiKeys.orgId], references: [organizations.id] }),
}))

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, { fields: [authSessions.userId], references: [users.id] }),
}))

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}))

// ─── Support Tickets ───────────────────────────────────────────────────────────

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  machineId: uuid('machine_id').references(() => machines.id, { onDelete: 'set null' }),
  subject: varchar('subject', { length: 255 }).notNull(),
  message: text('message').notNull(),
  agentLogs: text('agent_logs'),
  browserLogs: text('browser_logs'),
  aiDraft: text('ai_draft'),
  approvalToken: varchar('approval_token', { length: 255 }).unique(),
  status: supportTicketStatusEnum('status').notNull().default('pending'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  user: one(users, { fields: [supportTickets.userId], references: [users.id] }),
  machine: one(machines, { fields: [supportTickets.machineId], references: [machines.id] }),
}))

export const usersWithTicketsRelations = relations(users, ({ many }) => ({
  supportTickets: many(supportTickets),
}))
