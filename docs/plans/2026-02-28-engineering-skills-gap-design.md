# Engineering Skills Gap — Design Doc

**Date:** 2026-02-28
**Author:** Perry Bailes / Claude
**Status:** Approved — implementing Option B

---

## Goal

Close all engineering intelligence gaps across two tracks:

- **Product track** — SessionForge development (Next.js, Drizzle, tRPC, Cloud Run)
- **Consulting track** — Support Forge client delivery (AI integration, stack assessment, handoff)

---

## Approach: Option B

Create 10 new skills + targeted edits to 4 existing skills. No full rewrites.

---

## New Skills (10)

### Product Track

| Skill name                  | Purpose                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `frontend-dev-guidelines`   | React/Next.js App Router patterns, component architecture, TypeScript strictness, state management |
| `drizzle-orm-patterns`      | Transaction patterns, relation queries, migration workflow, query optimization for SessionForge    |
| `sessionforge-architecture` | Stack map: packages, auth flow, feature gating, deployment, env vars                               |
| `database-migrations`       | Drizzle generate → review → push vs migrate, zero-downtime, rollback strategy                      |
| `nextjs-app-router`         | Server vs client components, route handlers vs tRPC, middleware, dynamic segments                  |

### Consulting Track

| Skill name                 | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `tech-stack-assessment`    | Audit client stack, identify AI integration points, produce recommendation report |
| `prompt-engineering-coach` | Teach clients prompt writing, agent design, evaluation                            |
| `ai-integration-patterns`  | Common architectures: webhook→AI, RAG, agent loops, tool use, MCP                 |
| `client-handoff`           | Docs package, credentials, ongoing support setup, knowledge transfer              |

### Both Tracks

| Skill name          | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `git-workflow`      | Branching strategy, PR conventions, worktree feature workflow |
| `environment-setup` | Fresh dev env for SessionForge: env vars, DB, Redis, seeding  |
| `error-triage`      | Cloud Run logs, Sentry errors, triage bug vs config vs infra  |

---

## Enhancements (4 existing skills)

| Skill                     | Enhancement                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `back-end-dev-guidelines` | Add SessionForge-specific patterns: tRPC procedures, Drizzle over raw SQL, Zod validation flow |
| `senior-backend`          | Add SessionForge architecture context, decision history                                        |
| `qa-runbook`              | Fix dead `api/auth/me` reference → `/api/user`, add invite endpoints                           |
| `incident-response`       | Add Cloud Run + SessionForge specific runbook section                                          |

---

## File Locations

All new skills go to `C:/Users/Jakeb/.claude/skills/<skill-name>/SKILL.md`

Enhancements edit existing `SKILL.md` files in place.

---

## Success Criteria

- Every new skill has: name, description, when-to-use, examples, and commands
- SessionForge-specific skills reference actual file paths and commands
- Consulting skills produce deliverable artifacts (reports, docs, checklists)
- No duplicate coverage between skills
- qa-runbook references are accurate after update
