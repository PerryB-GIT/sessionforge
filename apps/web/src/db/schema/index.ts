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
  jsonb,
  uniqueIndex,
  index,
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
export const sessionStatusEnum = pgEnum('session_status', [
  'running',
  'stopped',
  'crashed',
  'paused',
])
export const ssoProviderEnum = pgEnum('sso_provider', ['oidc', 'saml'])

// ─── Users ─────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
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
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  plan: planEnum('plan').notNull().default('free'),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Org Members ───────────────────────────────────────────────────────────────

export const orgMembers = pgTable(
  'org_members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('org_members_org_id_idx').on(table.orgId),
    userIdIdx: index('org_members_user_id_idx').on(table.userId),
  })
)

// ─── Org Invites ───────────────────────────────────────────────────────────────

export const orgInvites = pgTable(
  'org_invites',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    token: varchar('token', { length: 64 }).notNull().unique(),
    role: memberRoleEnum('role').notNull().default('member'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('org_invites_org_id_idx').on(table.orgId),
    tokenIdx: index('org_invites_token_idx').on(table.token),
    orgEmailUniq: uniqueIndex('org_invites_org_id_email_key').on(table.orgId, table.email),
  })
)

// ─── Machines ──────────────────────────────────────────────────────────────────

export const machines = pgTable(
  'machines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
  },
  (table) => ({
    userIdIdx: index('machines_user_id_idx').on(table.userId),
    orgIdIdx: index('machines_org_id_idx').on(table.orgId),
    statusIdx: index('machines_status_idx').on(table.status),
  })
)

// ─── Sessions ──────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
  },
  (table) => ({
    machineIdIdx: index('sessions_machine_id_idx').on(table.machineId),
    userIdIdx: index('sessions_user_id_idx').on(table.userId),
    statusIdx: index('sessions_status_idx').on(table.status),
  })
)

// ─── API Keys ──────────────────────────────────────────────────────────────────

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
    keyPrefix: varchar('key_prefix', { length: 8 }).notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('api_keys_user_id_idx').on(table.userId),
  })
)

// ─── Auth: OAuth Accounts (NextAuth) ──────────────────────────────────────────

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
  },
  (table) => ({
    providerKey: uniqueIndex('accounts_provider_provider_account_id_key').on(
      table.provider,
      table.providerAccountId
    ),
  })
)

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

export const authSessions = pgTable(
  'sessions_auth',
  {
    sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => ({
    userIdIdx: index('sessions_auth_user_id_idx').on(table.userId),
  })
)

// ─── Password Reset Tokens ─────────────────────────────────────────────────────

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('password_reset_tokens_user_id_idx').on(table.userId),
  })
)

// ─── Support Tickets ───────────────────────────────────────────────────────────

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
  },
  (table) => ({
    userIdIdx: index('support_tickets_user_id_idx').on(table.userId),
    statusIdx: index('support_tickets_status_idx').on(table.status),
  })
)

// ─── SSO Configs ───────────────────────────────────────────────────────────────

export const ssoConfigs = pgTable(
  'sso_configs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' })
      .unique(),
    provider: ssoProviderEnum('provider').notNull(),
    clientId: text('client_id'),
    clientSecret: text('client_secret'),
    issuerUrl: text('issuer_url'),
    samlIdpMetadataUrl: text('saml_idp_metadata_url'),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('sso_configs_org_id_idx').on(table.orgId),
  })
)

// ─── Audit Logs ────────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 255 }),
    metadata: jsonb('metadata'),
    ip: varchar('ip', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('audit_logs_org_id_idx').on(table.orgId),
    actionIdx: index('audit_logs_action_idx').on(table.action),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.createdAt),
  })
)

// ─── IP Allowlists ─────────────────────────────────────────────────────────────

export const ipAllowlists = pgTable(
  'ip_allowlists',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    cidr: varchar('cidr', { length: 43 }).notNull(),
    label: varchar('label', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('ip_allowlists_org_id_idx').on(table.orgId),
  })
)

// ─── Notification Types ────────────────────────────────────────────────────────

export const notificationTypeEnum = pgEnum('notification_type', [
  'session_crashed',
  'machine_offline',
])

// ─── Notifications ─────────────────────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body').notNull(),
    resourceId: varchar('resource_id', { length: 255 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('notifications_user_id_idx').on(table.userId),
    readAtIdx: index('notifications_read_at_idx').on(table.readAt),
  })
)

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}))

// ─── Relations ─────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  organizations: many(orgMembers),
  machines: many(machines),
  sessions: many(sessions),
  apiKeys: many(apiKeys),
  authSessions: many(authSessions),
  passwordResetTokens: many(passwordResetTokens),
  supportTickets: many(supportTickets),
  auditLogs: many(auditLogs),
  notifications: many(notifications),
}))

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner: one(users, { fields: [organizations.ownerId], references: [users.id] }),
  members: many(orgMembers),
  machines: many(machines),
  apiKeys: many(apiKeys),
  invites: many(orgInvites),
  ssoConfig: one(ssoConfigs, { fields: [organizations.id], references: [ssoConfigs.orgId] }),
  auditLogs: many(auditLogs),
  ipAllowlists: many(ipAllowlists),
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

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  user: one(users, { fields: [supportTickets.userId], references: [users.id] }),
  machine: one(machines, { fields: [supportTickets.machineId], references: [machines.id] }),
}))

export const orgInvitesRelations = relations(orgInvites, ({ one }) => ({
  org: one(organizations, { fields: [orgInvites.orgId], references: [organizations.id] }),
  invitedByUser: one(users, { fields: [orgInvites.invitedBy], references: [users.id] }),
}))

export const ssoConfigsRelations = relations(ssoConfigs, ({ one }) => ({
  org: one(organizations, { fields: [ssoConfigs.orgId], references: [organizations.id] }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  org: one(organizations, { fields: [auditLogs.orgId], references: [organizations.id] }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}))

export const ipAllowlistsRelations = relations(ipAllowlists, ({ one }) => ({
  org: one(organizations, { fields: [ipAllowlists.orgId], references: [organizations.id] }),
}))
