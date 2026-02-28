# Team Invites Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the stub `inviteMember` tRPC procedure with a full pending-invite system: token-based email invites, an accept page, and auto-join on registration.

**Architecture:** A new `org_invites` table stores pending invites keyed by a random token with a 7-day TTL. The invite flow is: owner sends invite → invitee gets email → invitee clicks link → accept page checks token → adds to `org_members`. If the invitee doesn't have an account yet, they're routed to signup; on registration the auto-join hook picks up the pending invite automatically.

**Tech Stack:** Drizzle ORM (PostgreSQL), Next.js 14 App Router, tRPC, NextAuth v5, Resend (email), Zod, TypeScript

---

## Prerequisites / orientation

- Project root: `/c/Users/Jakeb/sessionforge/`
- All commands run from `apps/web/` unless otherwise noted
- Schema file: `apps/web/src/db/schema/index.ts`
- Migrations live in: `apps/web/src/db/migrations/`
- Run migrations: `npx drizzle-kit push` (dev) or generate SQL then apply manually
- Email util: `apps/web/src/lib/email.ts`
- tRPC org router: `apps/web/src/server/routers/org.ts`
- Plan config: `packages/shared-types/src/plans.ts` — `team_invites` feature already gated to `team+`
- The `db` import re-exports all tables: `apps/web/src/db/index.ts`
- API response shape used throughout: `{ data: T, error: null }` or `{ data: null, error: { code, message, statusCode } }`
- `auth()` from `@/lib/auth` gives `session.user.id` in route handlers

---

## Task 1: Add `orgInvites` table to Drizzle schema

**Files:**
- Modify: `apps/web/src/db/schema/index.ts`

**Step 1: Add the table definition**

After the `orgMembers` table (around line 74), add:

```typescript
// ─── Org Invites ───────────────────────────────────────────────────────────────

export const orgInvites = pgTable('org_invites', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  role: memberRoleEnum('role').notNull().default('member'),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgIdIdx: index('org_invites_org_id_idx').on(table.orgId),
  tokenIdx: index('org_invites_token_idx').on(table.token),
  orgEmailUniq: uniqueIndex('org_invites_org_id_email_key').on(table.orgId, table.email),
}))
```

**Step 2: Add the relation**

At the bottom of the relations section, add:

```typescript
export const orgInvitesRelations = relations(orgInvites, ({ one }) => ({
  org: one(organizations, { fields: [orgInvites.orgId], references: [organizations.id] }),
  invitedByUser: one(users, { fields: [orgInvites.invitedBy], references: [users.id] }),
}))
```

Also add `invites: many(orgInvites)` to `organizationsRelations`:

```typescript
export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner: one(users, { fields: [organizations.ownerId], references: [users.id] }),
  members: many(orgMembers),
  machines: many(machines),
  apiKeys: many(apiKeys),
  invites: many(orgInvites),  // add this line
}))
```

**Step 3: Re-export from db index**

Open `apps/web/src/db/index.ts`. Check if it re-exports everything from schema — if it uses `export * from './schema'` you're done. If it has explicit named exports, add `orgInvites` to the list.

**Step 4: Generate and apply migration**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npx drizzle-kit generate
```

This creates a new file in `src/db/migrations/`. Review it to confirm it contains:
- `CREATE TABLE org_invites (...)`
- The two indexes and unique constraint

Then apply it:
```bash
npx drizzle-kit push
```

Expected: no errors, table visible in DB.

**Step 5: Commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add apps/web/src/db/schema/index.ts apps/web/src/db/migrations/
git commit -m "feat: add org_invites table to schema"
```

---

## Task 2: Add `sendInviteEmail` to email utility

**Files:**
- Modify: `apps/web/src/lib/email.ts`

**Step 1: Add the function at the end of the file**

```typescript
export async function sendInviteEmail(
  to: string,
  inviterName: string | null,
  orgName: string,
  acceptUrl: string,
) {
  const resend = new Resend(process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY)
  const displayInviter = inviterName ?? 'Someone'

  // Non-blocking — caller should .catch() this
  await resend.emails.send({
    from: FROM,
    to,
    subject: `You've been invited to join ${orgName} on SessionForge`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f0f14;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden">
        <!-- Header -->
        <tr>
          <td style="padding:32px 40px 24px;border-bottom:1px solid #1e1e2e">
            <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Session<span style="color:#8b5cf6">Forge</span></span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 40px">
            <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#ffffff">You're invited</p>
            <p style="margin:0 0 24px;font-size:14px;color:#9ca3af;line-height:1.6">
              ${displayInviter} has invited you to join <strong style="color:#ffffff">${orgName}</strong> on SessionForge.
              Click the button below to accept your invitation.
            </p>
            <a href="${acceptUrl}"
               style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">
              Accept Invitation
            </a>
            <p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.6">
              This invitation expires in 7 days. If you weren't expecting this, you can safely ignore it.
            </p>
            <p style="margin:16px 0 0;font-size:12px;color:#4b5563;word-break:break-all">
              Or copy this link: <a href="${acceptUrl}" style="color:#8b5cf6">${acceptUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1e1e2e">
            <p style="margin:0;font-size:12px;color:#4b5563">
              SessionForge LLC · You're receiving this because someone invited you to their organization.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  })
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

**Step 3: Commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add apps/web/src/lib/email.ts
git commit -m "feat: add sendInviteEmail function"
```

---

## Task 3: Replace `inviteMember` tRPC procedure, add `listInvites` and `revokeInvite`

**Files:**
- Modify: `apps/web/src/server/routers/org.ts`

**Step 1: Update imports at the top of the file**

Change:
```typescript
import { db, organizations, orgMembers, users } from '@/db'
```
To:
```typescript
import { db, organizations, orgMembers, orgInvites, users } from '@/db'
import { randomBytes } from 'crypto'
import { sendInviteEmail } from '@/lib/email'
```

Also add `lt, isNull` to the drizzle imports:
```typescript
import { eq, and, lt, isNull } from 'drizzle-orm'
```

**Step 2: Replace the `inviteMember` procedure entirely (lines 116–185)**

Delete the old `inviteMember` block and replace with:

```typescript
/** Invite a member to the org by email (token-based, no account required) */
inviteMember: protectedProcedure
  .input(
    z.object({
      orgId: z.string().uuid(),
      email: z.string().email().transform((e) => e.toLowerCase()),
      role: z.enum(['admin', 'member', 'viewer']).default('member'),
    })
  )
  .mutation(async ({ ctx, input }) => {
    // Require team_invites feature (team plan and above)
    try {
      await requireFeature(ctx.userId, 'team_invites')
    } catch (err) {
      if (err instanceof FeatureNotAvailableError) {
        throw new TRPCError({ code: 'FORBIDDEN', message: err.message })
      }
      throw err
    }

    // Caller must be owner or admin
    const [membership] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1)

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only org owners and admins can invite members' })
    }

    // Cannot invite yourself
    const [caller] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)

    if (caller?.email === input.email) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot invite yourself' })
    }

    // Check if already a member
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1)

    if (existingUser) {
      const [existingMember] = await db
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, existingUser.id)))
        .limit(1)

      if (existingMember) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This person is already a member of your organization' })
      }
    }

    // Fetch org name for email
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, input.orgId))
      .limit(1)

    if (!org) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' })
    }

    // Upsert invite (replace existing pending invite for same email in this org)
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const [invite] = await db
      .insert(orgInvites)
      .values({
        orgId: input.orgId,
        email: input.email,
        token,
        role: input.role,
        invitedBy: ctx.userId,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [orgInvites.orgId, orgInvites.email],  // matches the unique index
        set: {
          token,
          role: input.role,
          invitedBy: ctx.userId,
          expiresAt,
          acceptedAt: null,
          createdAt: new Date(),
        },
      })
      .returning()

    if (!invite) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create invitation' })
    }

    // Send invite email — non-blocking
    const APP_URL = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
    const acceptUrl = `${APP_URL}/invite/${token}`
    const inviterName = caller?.email ?? null  // could fetch name instead

    sendInviteEmail(input.email, inviterName, org.name, acceptUrl).catch((err) => {
      console.error('[inviteMember] failed to send invite email:', err)
    })

    return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }
  }),

/** List pending (not yet accepted) invites for an org */
listInvites: protectedProcedure
  .input(z.object({ orgId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    // Must be owner or admin
    const [membership] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1)

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only org owners and admins can view invitations' })
    }

    const invites = await db
      .select({
        id: orgInvites.id,
        email: orgInvites.email,
        role: orgInvites.role,
        expiresAt: orgInvites.expiresAt,
        createdAt: orgInvites.createdAt,
      })
      .from(orgInvites)
      .where(
        and(
          eq(orgInvites.orgId, input.orgId),
          isNull(orgInvites.acceptedAt),
          // only pending (not expired)
        )
      )
      .orderBy(orgInvites.createdAt)

    // Filter out expired in-memory (or add a DB filter)
    const now = new Date()
    return invites.filter((i) => i.expiresAt > now)
  }),

/** Revoke a pending invite */
revokeInvite: protectedProcedure
  .input(z.object({ inviteId: z.string().uuid(), orgId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    // Must be owner or admin
    const [membership] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, input.orgId), eq(orgMembers.userId, ctx.userId)))
      .limit(1)

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only org owners and admins can revoke invitations' })
    }

    const [deleted] = await db
      .delete(orgInvites)
      .where(and(eq(orgInvites.id, input.inviteId), eq(orgInvites.orgId, input.orgId)))
      .returning({ id: orgInvites.id })

    if (!deleted) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' })
    }

    return { id: deleted.id, revoked: true }
  }),
```

**Step 3: Verify TypeScript compiles**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

**Step 4: Commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add apps/web/src/server/routers/org.ts
git commit -m "feat: replace inviteMember stub with token-based invite flow"
```

---

## Task 4: Add `POST /api/org/members` route handler

The UI already hits `POST /api/org/members` — wire it up.

**Files:**
- Modify: `apps/web/src/app/api/org/members/route.ts`

**Step 1: Add the POST handler at the end of the file**

```typescript
import { NextRequest, NextResponse } from 'next/server'
// (existing imports stay — add these at top if not already present)
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { orgInvites } from '@/db/schema'
import { requireFeature, FeatureNotAvailableError } from '@/lib/plan-enforcement'
import { sendInviteEmail } from '@/lib/email'
```

Add to the bottom of the file:

```typescript
// ─── POST /api/org/members ──────────────────────────────────────────────────
// Send an invite to join the authenticated user's organization.
// Requires team plan. Upserts the invite row, sends email.

const inviteBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  // Parse body
  const body = await req.json().catch(() => ({}))
  const parsed = inviteBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message ?? 'Invalid input', statusCode: 400 } } satisfies ApiError,
      { status: 400 }
    )
  }

  const { email, role } = parsed.data
  const normalizedEmail = email.toLowerCase()

  // Feature gate
  try {
    await requireFeature(session.user.id, 'team_invites')
  } catch (err) {
    if (err instanceof FeatureNotAvailableError) {
      return NextResponse.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Team invitations require a Team plan or higher', statusCode: 403 } } satisfies ApiError,
        { status: 403 }
      )
    }
    throw err
  }

  // Find the user's org (owner)
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.ownerId, session.user.id))
    .limit(1)

  if (!org) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'No organization found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  // Cannot invite yourself
  if (normalizedEmail === session.user.email?.toLowerCase()) {
    return NextResponse.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'You cannot invite yourself', statusCode: 400 } } satisfies ApiError,
      { status: 400 }
    )
  }

  // Check if already a member
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (existingUser) {
    const [existingMember] = await db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, existingUser.id)))
      .limit(1)

    if (existingMember) {
      return NextResponse.json(
        { data: null, error: { code: 'CONFLICT', message: 'This person is already a member of your organization', statusCode: 409 } } satisfies ApiError,
        { status: 409 }
      )
    }
  }

  // Upsert invite
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const [invite] = await db
    .insert(orgInvites)
    .values({
      orgId: org.id,
      email: normalizedEmail,
      token,
      role,
      invitedBy: session.user.id,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [orgInvites.orgId, orgInvites.email],
      set: { token, role, invitedBy: session.user.id, expiresAt, acceptedAt: null, createdAt: new Date() },
    })
    .returning()

  if (!invite) {
    return NextResponse.json(
      { data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create invitation', statusCode: 500 } } satisfies ApiError,
      { status: 500 }
    )
  }

  // Send email — non-blocking
  const APP_URL = process.env.NEXTAUTH_URL ?? 'https://sessionforge.dev'
  const acceptUrl = `${APP_URL}/invite/${token}`
  sendInviteEmail(normalizedEmail, session.user.name ?? session.user.email ?? null, org.name, acceptUrl).catch((err) => {
    console.error('[POST /api/org/members] failed to send invite email:', err)
  })

  return NextResponse.json(
    { data: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }, error: null },
    { status: 201 }
  )
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npx tsc --noEmit 2>&1 | head -30
```

**Step 3: Commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add apps/web/src/app/api/org/members/route.ts
git commit -m "feat: add POST /api/org/members invite endpoint"
```

---

## Task 5: Create `POST /api/org/invites/[token]/accept` route

**Files:**
- Create: `apps/web/src/app/api/org/invites/[token]/accept/route.ts`

**Step 1: Create the directory and file**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, and, isNull } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgMembers, orgInvites, users } from '@/db'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { token } = params

  // Look up the invite
  const [invite] = await db
    .select({
      id: orgInvites.id,
      orgId: orgInvites.orgId,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      acceptedAt: orgInvites.acceptedAt,
    })
    .from(orgInvites)
    .where(eq(orgInvites.token, token))
    .limit(1)

  if (!invite) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Invitation not found or already used', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  if (invite.acceptedAt) {
    return NextResponse.json(
      { data: null, error: { code: 'CONFLICT', message: 'This invitation has already been accepted', statusCode: 409 } } satisfies ApiError,
      { status: 409 }
    )
  }

  if (invite.expiresAt < new Date()) {
    return NextResponse.json(
      { data: null, error: { code: 'GONE', message: 'This invitation has expired. Ask your admin to send a new one.', statusCode: 410 } } satisfies ApiError,
      { status: 410 }
    )
  }

  // Must be logged in to accept
  const session = await auth()
  if (!session?.user?.id) {
    // Return 401 with redirect hint — the accept page will handle redirect to signup
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'You must be logged in to accept this invitation', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  // Check their email matches (optional strictness — we enforce it)
  const [acceptingUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  if (!acceptingUser) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'User not found', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  if (acceptingUser.email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { data: null, error: { code: 'FORBIDDEN', message: 'This invitation was sent to a different email address', statusCode: 403 } } satisfies ApiError,
      { status: 403 }
    )
  }

  // Check not already a member
  const [existingMember] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, invite.orgId), eq(orgMembers.userId, acceptingUser.id)))
    .limit(1)

  if (existingMember) {
    // Mark accepted anyway, return success
    await db
      .update(orgInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(orgInvites.id, invite.id))

    const [org] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, invite.orgId))
      .limit(1)

    return NextResponse.json({ data: { orgId: invite.orgId, orgName: org?.name ?? '' }, error: null })
  }

  // Add to org_members and mark invite accepted
  await db.insert(orgMembers).values({
    orgId: invite.orgId,
    userId: acceptingUser.id,
    role: invite.role,
  })

  await db
    .update(orgInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(orgInvites.id, invite.id))

  // Fetch org name for response
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.orgId))
    .limit(1)

  return NextResponse.json({
    data: { orgId: invite.orgId, orgName: org?.name ?? '' },
    error: null,
  } satisfies ApiResponse<{ orgId: string; orgName: string }>)
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npx tsc --noEmit 2>&1 | head -30
```

**Step 3: Commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add apps/web/src/app/api/org/invites/
git commit -m "feat: add invite accept API endpoint"
```

---

## Task 6: Create the `/invite/[token]` accept page

This is a public page (no auth required) that validates the token and lets the user click "Join".

**Files:**
- Create: `apps/web/src/app/(public)/invite/[token]/page.tsx`

**Step 1: Check if a `(public)` route group exists**

```bash
ls /c/Users/Jakeb/sessionforge/apps/web/src/app/
```

If there's no `(public)` group, place the file at `apps/web/src/app/invite/[token]/page.tsx` instead. Either works — just make sure the route isn't inside `(dashboard)` (which requires auth).

**Step 2: Create the page**

```tsx
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, orgInvites, organizations } from '@/db'
import InviteAcceptClient from './accept-client'

interface Props {
  params: { token: string }
}

export default async function InvitePage({ params }: Props) {
  const { token } = params

  const [invite] = await db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      expiresAt: orgInvites.expiresAt,
      acceptedAt: orgInvites.acceptedAt,
      orgId: orgInvites.orgId,
    })
    .from(orgInvites)
    .where(eq(orgInvites.token, token))
    .limit(1)

  if (!invite) {
    notFound()
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.orgId))
    .limit(1)

  const expired = invite.expiresAt < new Date()
  const accepted = !!invite.acceptedAt

  return (
    <InviteAcceptClient
      token={token}
      orgName={org?.name ?? 'an organization'}
      email={invite.email}
      expired={expired}
      accepted={accepted}
    />
  )
}
```

**Step 3: Create the client component alongside it**

Create `apps/web/src/app/(public)/invite/[token]/accept-client.tsx` (or same folder as page.tsx):

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Props {
  token: string
  orgName: string
  email: string
  expired: boolean
  accepted: boolean
}

export default function InviteAcceptClient({ token, orgName, email, expired, accepted }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  if (accepted) {
    return (
      <InviteShell>
        <p className="text-xl font-semibold text-white mb-2">Already accepted</p>
        <p className="text-sm text-gray-400">You're already a member of <strong className="text-white">{orgName}</strong>.</p>
        <a href="/dashboard" className="mt-6 inline-block px-5 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-500 transition-colors">
          Go to Dashboard
        </a>
      </InviteShell>
    )
  }

  if (expired) {
    return (
      <InviteShell>
        <p className="text-xl font-semibold text-white mb-2">Invitation expired</p>
        <p className="text-sm text-gray-400">This invitation has expired. Ask your admin to send a new one.</p>
      </InviteShell>
    )
  }

  async function handleAccept() {
    setLoading(true)
    try {
      const res = await fetch(`/api/org/invites/${token}/accept`, { method: 'POST' })
      const json = await res.json()

      if (res.status === 401) {
        // Not logged in — redirect to signup with invite param
        router.push(`/signup?invite=${token}`)
        return
      }

      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to accept invitation')
        return
      }

      toast.success(`You've joined ${orgName}!`)
      router.push('/dashboard')
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <InviteShell>
      <p className="text-xl font-semibold text-white mb-2">You've been invited</p>
      <p className="text-sm text-gray-400 mb-6">
        Join <strong className="text-white">{orgName}</strong> on SessionForge.
        This invite was sent to <span className="text-gray-300">{email}</span>.
      </p>
      <button
        onClick={handleAccept}
        disabled={loading}
        className="px-6 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-500 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Joining...' : `Join ${orgName}`}
      </button>
    </InviteShell>
  )
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#1e1e2e] bg-[#0f0f14] p-8 text-center">
        <span className="block text-2xl font-bold text-white mb-6">
          Session<span className="text-purple-400">Forge</span>
        </span>
        {children}
      </div>
    </div>
  )
}
```

**Step 4: Make sure middleware allows `/invite/*` without auth**

Open `apps/web/src/middleware.ts`. Find where public routes are defined. Add `/invite` to the public paths list. Example — if it has something like:

```typescript
const PUBLIC_PATHS = ['/login', '/signup', '/api/auth', ...]
```

Add `'/invite'` or use a matcher like `pathname.startsWith('/invite')`.

**Step 5: Verify TypeScript compiles**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npx tsc --noEmit 2>&1 | head -30
```

**Step 6: Commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add apps/web/src/app/
git commit -m "feat: add /invite/[token] accept page"
```

---

## Task 7: Auto-join on registration

When a new user registers and there's a pending invite for their email, add them to the org automatically.

**Files:**
- Modify: `apps/web/src/app/api/auth/register/route.ts`

**Step 1: Add imports at the top**

```typescript
import { orgInvites, orgMembers } from '@/db/schema'
import { isNull } from 'drizzle-orm'
```

**Step 2: After the user is created (after line 92 `if (!newUser) { throw... }`), add the auto-join block**

Insert this after the `if (!newUser)` check and before the verification token block:

```typescript
// Auto-join: if there's a pending invite for this email, add to the org
try {
  const now = new Date()
  const [pendingInvite] = await db
    .select({ id: orgInvites.id, orgId: orgInvites.orgId, role: orgInvites.role })
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.email, normalizedEmail),
        isNull(orgInvites.acceptedAt),
        // expiresAt > now — Drizzle: use gt(orgInvites.expiresAt, now)
      )
    )
    .limit(1)

  if (pendingInvite && pendingInvite.expiresAt > now) {
    await db.insert(orgMembers).values({
      orgId: pendingInvite.orgId,
      userId: newUser.id,
      role: pendingInvite.role,
    })
    await db
      .update(orgInvites)
      .set({ acceptedAt: now })
      .where(eq(orgInvites.id, pendingInvite.id))
  }
} catch (err) {
  // Non-fatal — user is created, just log
  console.error('[register] auto-join invite check failed:', err)
}
```

Note: the Drizzle `gt` import — add `gt` to the import from `drizzle-orm`:
```typescript
import { eq, and, gt, isNull } from 'drizzle-orm'
```

And fix the where clause to use `gt`:
```typescript
.where(
  and(
    eq(orgInvites.email, normalizedEmail),
    isNull(orgInvites.acceptedAt),
    gt(orgInvites.expiresAt, now),
  )
)
```

**Step 3: Verify TypeScript compiles**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npx tsc --noEmit 2>&1 | head -30
```

**Step 4: Commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add apps/web/src/app/api/auth/register/route.ts
git commit -m "feat: auto-join org on registration if pending invite exists"
```

---

## Task 8: Wire up pending invites list + revoke in the settings UI

Show pending invites below the members list with a Revoke button.

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/org/page.tsx`

**Step 1: Add state for pending invites**

Add near the other `useState` calls (around line 68):

```typescript
type PendingInvite = { id: string; email: string; role: string; expiresAt: string }
const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
```

**Step 2: Fetch pending invites on mount**

Inside the existing `useEffect` (after the `/api/org/members` fetch), add a fetch for the org ID then invites. Since we need the org ID, chain off the existing `/api/org` fetch:

```typescript
useEffect(() => {
  let orgId: string | null = null

  fetch('/api/org')
    .then((r) => r.json())
    .then((json) => {
      if (json.data) {
        reset({ name: json.data.name, slug: json.data.slug })
        orgId = json.data.id

        // Fetch pending invites once we have the org ID
        // We'll use tRPC client or a new REST endpoint
        // Simplest: add GET /api/org/invites
        fetch('/api/org/invites')
          .then((r) => r.json())
          .then((j) => { if (j.data) setPendingInvites(j.data) })
          .catch(() => {})
      }
    })
    .catch(() => {})
  // ... rest of existing fetches
}, [reset])
```

**Step 3: Add revoke handler**

```typescript
async function revokeInvite(inviteId: string) {
  try {
    const res = await fetch(`/api/org/invites/${inviteId}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json()
      toast.error(json.error?.message ?? 'Failed to revoke invitation')
      return
    }
    setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId))
    toast.success('Invitation revoked')
  } catch {
    toast.error('Failed to revoke invitation')
  }
}
```

**Step 4: Add pending invites section to the Team Members card**

Below the existing `members.map(...)` block and before the closing `</CardContent>`, add:

```tsx
{pendingInvites.length > 0 && (
  <div className="mt-4 pt-4 border-t border-[#1e1e2e]">
    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Pending Invitations</p>
    <div className="space-y-2">
      {pendingInvites.map((invite) => (
        <div key={invite.id} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1e1e2e] border border-[#2a2a3e] text-sm text-gray-500">
              <Mail className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-sm text-gray-300">{invite.email}</p>
              <p className="text-xs text-gray-600">Invited · expires {new Date(invite.expiresAt).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs text-gray-500">{invite.role}</Badge>
            <button
              onClick={() => revokeInvite(invite.id)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Revoke
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
```

**Step 5: Add `sendInvite` success refresh**

After `toast.success(...)` in `sendInvite`, re-fetch invites:

```typescript
toast.success(`Invitation sent to ${data.email}`)
setInviteOpen(false)
resetInvite()
// Refresh pending invites list
fetch('/api/org/invites')
  .then((r) => r.json())
  .then((j) => { if (j.data) setPendingInvites(j.data) })
  .catch(() => {})
```

**Step 6: Create `GET /api/org/invites` and `DELETE /api/org/invites/[id]` REST endpoints**

Create `apps/web/src/app/api/org/invites/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgInvites } from '@/db'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerId, session.user.id))
    .limit(1)

  if (!org) {
    return NextResponse.json({ data: [], error: null })
  }

  const now = new Date()
  const invites = await db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      createdAt: orgInvites.createdAt,
    })
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.orgId, org.id),
        isNull(orgInvites.acceptedAt),
        gt(orgInvites.expiresAt, now),
      )
    )
    .orderBy(orgInvites.createdAt)

  return NextResponse.json({ data: invites, error: null } satisfies ApiResponse<typeof invites>)
}
```

Create `apps/web/src/app/api/org/invites/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, organizations, orgInvites } from '@/db'
import type { ApiError, ApiResponse } from '@sessionforge/shared-types'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 } } satisfies ApiError,
      { status: 401 }
    )
  }

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerId, session.user.id))
    .limit(1)

  if (!org) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'No organization found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  const [deleted] = await db
    .delete(orgInvites)
    .where(and(eq(orgInvites.id, params.id), eq(orgInvites.orgId, org.id)))
    .returning({ id: orgInvites.id })

  if (!deleted) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'Invitation not found', statusCode: 404 } } satisfies ApiError,
      { status: 404 }
    )
  }

  return NextResponse.json({ data: { id: deleted.id, revoked: true }, error: null } satisfies ApiResponse<{ id: string; revoked: boolean }>)
}
```

**Step 7: Verify TypeScript compiles**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npx tsc --noEmit 2>&1 | head -30
```

**Step 8: Commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add apps/web/src/app/api/org/invites/ apps/web/src/app/(dashboard)/settings/org/page.tsx
git commit -m "feat: show pending invites with revoke in org settings UI"
```

---

## Task 9: Smoke test the full flow locally

**Step 1: Start the dev server**

```bash
cd /c/Users/Jakeb/sessionforge/apps/web
npm run dev
```

**Step 2: Manual smoke test checklist**

Work through these in the browser:

1. Log in as a **team plan user** (or temporarily patch plan enforcement in dev)
2. Go to `/settings/org` → click "Invite Member" → enter an email → click "Send Invite"
   - Expected: `toast.success("Invitation sent to ...")`, invite appears in Pending list
3. Check the console/Resend dashboard that the email fired (or look at the non-blocking log)
4. Open the invite URL `/invite/<token>` in an **incognito window**
   - If not logged in: click "Join" → should redirect to `/signup?invite=<token>`
   - Register as the invited email → should auto-join the org
5. Open the invite URL when **logged in as the invited user** → click "Join" → should add to org and redirect to `/dashboard`
6. Go back to `/settings/org` → Pending Invites section should now be empty (invite accepted)
7. Click "Revoke" on a pending invite → invite disappears from list
8. Try to invite an existing member → should see conflict error toast

**Step 3: Test free plan guard**

Log in as a **free plan user**, try to invite → should see "Team invitations require a Team plan" error.

**Step 4: Commit any fixes found during smoke test**

---

## Task 10: Final cleanup and type export

**Files:**
- Check: `packages/shared-types/src/db-types.ts`

**Step 1: Add OrgInvite type if not already there**

```typescript
export type OrgInvite = {
  id: string
  orgId: string
  email: string
  token: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  invitedBy: string | null
  expiresAt: Date
  acceptedAt: Date | null
  createdAt: Date
}
```

**Step 2: Final TypeScript check across the whole monorepo**

```bash
cd /c/Users/Jakeb/sessionforge
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -50
```

Expected: 0 errors.

**Step 3: Final commit**

```bash
cd /c/Users/Jakeb/sessionforge
git add packages/shared-types/
git commit -m "feat: export OrgInvite type from shared-types"
```

---

## Summary of all files changed

| File | Action |
|---|---|
| `apps/web/src/db/schema/index.ts` | Add `orgInvites` table + relations |
| `apps/web/src/db/migrations/000X_*.sql` | Generated migration |
| `apps/web/src/lib/email.ts` | Add `sendInviteEmail()` |
| `apps/web/src/server/routers/org.ts` | Replace `inviteMember`; add `listInvites`, `revokeInvite` |
| `apps/web/src/app/api/org/members/route.ts` | Add `POST` handler |
| `apps/web/src/app/api/org/invites/route.ts` | New — `GET` pending invites |
| `apps/web/src/app/api/org/invites/[id]/route.ts` | New — `DELETE` revoke |
| `apps/web/src/app/api/org/invites/[token]/accept/route.ts` | New — `POST` accept |
| `apps/web/src/app/invite/[token]/page.tsx` | New — server component |
| `apps/web/src/app/invite/[token]/accept-client.tsx` | New — client component |
| `apps/web/src/middleware.ts` | Add `/invite` to public paths |
| `apps/web/src/app/api/auth/register/route.ts` | Auto-join on registration |
| `apps/web/src/app/(dashboard)/settings/org/page.tsx` | Pending invites UI + revoke |
| `packages/shared-types/src/db-types.ts` | Add `OrgInvite` type |
