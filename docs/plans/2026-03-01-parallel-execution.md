# Parallel Execution Orchestration Plan

> **For Claude:** This plan coordinates 5 Claude Code instances (each with subagent capability) to close all engineering gaps across three feature branches simultaneously. **Orchestrator (Instance 1) runs this file. Instances 2-4 each receive their branch plan file. Instance 5 runs the QA runbook after each branch merges.**

**Goal:** Close all 26 engineering gap tasks across `feat/core-gaps` (10 tasks), `feat/pro-team-gaps` (8 tasks), and `feat/enterprise-gaps` (8 tasks) using 5 parallel Claude Code instances — reducing wall-clock time from ~3 sequential days to ~1 day.

**Architecture:** Instance 1 is the Orchestrator. Instances 2, 3, 4 are Branch Implementers. Instance 5 is the QA Agent. Branches must merge in order: core → pro/team → enterprise. Instances 3 and 4 start immediately (they branch from `main`, not from each other), but cannot merge until their predecessor has merged and `main` is updated.

**Skill requirements per instance:**

- All instances: `superpowers:subagent-driven-development`
- All instances: `superpowers:using-git-worktrees`
- Instance 5: `qa-runbook` + all chained QA skills

---

## Instance Assignments

| Instance | Role                   | Branch                 | Plan File                                  | Works On                                   |
| -------- | ---------------------- | ---------------------- | ------------------------------------------ | ------------------------------------------ |
| **1**    | Orchestrator           | `main`                 | This file                                  | Coordination, review gates, merge, rebases |
| **2**    | Core Implementer       | `feat/core-gaps`       | `docs/plans/2026-03-01-core-gaps.md`       | Tasks C1–C10                               |
| **3**    | Pro/Team Implementer   | `feat/pro-team-gaps`   | `docs/plans/2026-03-01-pro-team-gaps.md`   | Tasks P1–P8                                |
| **4**    | Enterprise Implementer | `feat/enterprise-gaps` | `docs/plans/2026-03-01-enterprise-gaps.md` | Tasks E1–E8                                |
| **5**    | QA Agent               | staging                | `skills/qa-runbook`                        | QA gate after each branch                  |

---

## Dependency Graph

```
main
 ├── feat/core-gaps (Instance 2) ──────────────────────────────► merge → main
 │                                                                       │
 ├── feat/pro-team-gaps (Instance 3, starts immediately)                 │
 │   └── [waits for core merge before merging] ──────────────────────────► merge → main
 │                                                                       │
 └── feat/enterprise-gaps (Instance 4, starts immediately)              │
     └── [waits for pro/team merge before merging] ──────────────────────► merge → main
                                                                         │
Instance 5 (QA) runs after each branch merge ──────────────────────────►  deploy
```

**Key rule:** All three branches are developed in parallel. Merge order is enforced: core first, then pro/team, then enterprise. Instances 3 and 4 must rebase onto `main` before their PR merges.

---

## Phase 1: Launch (Orchestrator runs this once)

### Step 1: Verify clean main

```bash
cd C:/Users/Jakeb/sessionforge
git checkout main && git pull
git status  # must be clean
npm run type-check  # must pass before any branches start
npm run build       # must pass before any branches start
```

Expected: 0 TypeScript errors, successful build.

### Step 2: Confirm worktrees directory is ready

```bash
ls C:/Users/Jakeb/sessionforge/.worktrees/
```

If directory does not exist:

```bash
mkdir -p C:/Users/Jakeb/sessionforge/.worktrees
```

### Step 3: Create all three worktrees

Run these three commands in parallel (they are independent):

```bash
# Worktree for Instance 2 (core)
git worktree add .worktrees/core-gaps -b feat/core-gaps

# Worktree for Instance 3 (pro/team)
git worktree add .worktrees/pro-team-gaps -b feat/pro-team-gaps

# Worktree for Instance 4 (enterprise)
git worktree add .worktrees/enterprise-gaps -b feat/enterprise-gaps
```

### Step 4: Dispatch Instances 2, 3, 4

Send each instance its startup message (see **Instance Startup Messages** section below). All three start simultaneously.

Instance 5 (QA) is not dispatched yet — it launches after the first branch merge.

---

## Phase 2: Branch Development (parallel, no Orchestrator action needed)

Instances 2, 3, and 4 each run `superpowers:subagent-driven-development` against their plan file. Per that skill:

- Each task gets a **fresh implementer subagent**
- After each task: **spec compliance reviewer** subagent → **code quality reviewer** subagent
- Reviews must both pass before moving to next task
- Each task ends with a commit

Instance 2 works in `.worktrees/core-gaps/`
Instance 3 works in `.worktrees/pro-team-gaps/`
Instance 4 works in `.worktrees/enterprise-gaps/`

**No cross-instance coordination needed during this phase.** Each branch owns separate files.

---

## Phase 3: Merge Gate — Core (Orchestrator)

Triggered when: **Instance 2 signals all C10 tasks complete.**

### Step 1: Pull Instance 2's work

```bash
cd C:/Users/Jakeb/sessionforge
git fetch origin feat/core-gaps
```

### Step 2: Run pre-merge checks on the core worktree

```bash
cd .worktrees/core-gaps
npm run type-check
npm run test:unit
```

Expected: 0 failures.

### Step 3: Dispatch Instance 5 (QA Agent) against staging

Send Instance 5 the QA runbook startup message. It runs Steps 1–9 of the QA runbook against the `feat/core-gaps` branch deployed to staging.

**Instance 5 startup message:**

```
You are the QA Agent for SessionForge. Invoke the qa-runbook skill and run all 9 steps against the feat/core-gaps branch on staging.

Branch: feat/core-gaps
Worktree: C:/Users/Jakeb/sessionforge/.worktrees/core-gaps
Staging URL: [your staging Cloud Run URL]

Complete all 9 steps in order. Report PASS/FAIL for each step. If any step is NO-GO, report the exact failure and stop — do not proceed to subsequent steps.
```

### Step 4: If QA passes — merge core

```bash
cd C:/Users/Jakeb/sessionforge
git checkout main
git merge --no-ff feat/core-gaps -m "feat: close core engineering gaps (xterm.js, notifications, delete account)"
git push origin main
```

### Step 5: Run DB migrations on staging

```bash
cd apps/web
DATABASE_URL="<staging-db-url>" npm run db:migrate
```

### Step 6: Notify Instances 3 and 4 to rebase

Send this message to Instance 3 and Instance 4:

```
main has been updated with feat/core-gaps. Please rebase your branch onto main now:

git fetch origin main
git rebase origin/main

Resolve any conflicts (there should be none — you own separate files). Then continue with your next task.
```

---

## Phase 4: Merge Gate — Pro/Team (Orchestrator)

Triggered when: **Instance 3 signals all P8 tasks complete AND Instance 2's core merge is done.**

### Step 1: Rebase pro/team onto updated main

```bash
cd .worktrees/pro-team-gaps
git fetch origin main
git rebase origin/main
```

Expected: no conflicts (core and pro/team own different files).

### Step 2: Run pre-merge checks

```bash
cd .worktrees/pro-team-gaps
npm run type-check
npm run test:unit
```

Expected: 0 failures.

### Step 3: Dispatch Instance 5 (QA Agent) for pro/team

```
You are the QA Agent for SessionForge. Invoke the qa-runbook skill and run all 9 steps against the feat/pro-team-gaps branch on staging.

Branch: feat/pro-team-gaps
Worktree: C:/Users/Jakeb/sessionforge/.worktrees/pro-team-gaps
Staging URL: [your staging Cloud Run URL]

Complete all 9 steps in order. Report PASS/FAIL for each step. If any step is NO-GO, report the exact failure and stop.
```

### Step 4: If QA passes — merge pro/team

```bash
cd C:/Users/Jakeb/sessionforge
git checkout main
git merge --no-ff feat/pro-team-gaps -m "feat: close pro/team engineering gaps (webhooks, GCS archival, RBAC)"
git push origin main
```

### Step 5: Run DB migrations on staging

```bash
cd apps/web
DATABASE_URL="<staging-db-url>" npm run db:migrate
```

### Step 6: Notify Instance 4 to rebase

```
main has been updated with feat/pro-team-gaps. Rebase your branch:

git fetch origin main
git rebase origin/main

Then continue your remaining tasks.
```

---

## Phase 5: Merge Gate — Enterprise (Orchestrator)

Triggered when: **Instance 4 signals all E8 tasks complete AND pro/team merge is done.**

### Step 1: Rebase enterprise onto updated main

```bash
cd .worktrees/enterprise-gaps
git fetch origin main
git rebase origin/main
```

### Step 2: Run pre-merge checks

```bash
cd .worktrees/enterprise-gaps
npm run type-check
npm run test:unit
```

Expected: 0 failures.

### Step 3: Dispatch Instance 5 (QA Agent) for enterprise

```
You are the QA Agent for SessionForge. Invoke the qa-runbook skill and run all 9 steps against the feat/enterprise-gaps branch on staging.

Branch: feat/enterprise-gaps
Worktree: C:/Users/Jakeb/sessionforge/.worktrees/enterprise-gaps
Staging URL: [your staging Cloud Run URL]

Complete all 9 steps in order. Report PASS/FAIL for each step. If any step is NO-GO, report the exact failure and stop.
```

### Step 4: If QA passes — merge enterprise

```bash
cd C:/Users/Jakeb/sessionforge
git checkout main
git merge --no-ff feat/enterprise-gaps -m "feat: close enterprise engineering gaps (SSO, audit log, session recording, IP allowlist)"
git push origin main
```

### Step 5: Run DB migrations on staging

```bash
cd apps/web
DATABASE_URL="<staging-db-url>" npm run db:migrate
```

---

## Phase 6: Production Deploy

All three branches merged. Run `/cloud-run-deploy` for the full production deploy runbook.

Pre-deploy checklist:

- [ ] All 26 tasks committed across three branches
- [ ] All three QA runbook passes (one per branch)
- [ ] `git status` clean on `main`
- [ ] CI green on `main` (GitHub Actions — lint, typecheck, build, Go agent)
- [ ] Staging smoke-tested at Cloud Run staging URL
- [ ] DB migrations verified on staging

Then trigger the production deploy via GitHub Actions (manual `workflow_dispatch` with `confirm: deploy-production`).

### Step: Clean up worktrees after merge

```bash
cd C:/Users/Jakeb/sessionforge
git worktree remove .worktrees/core-gaps
git worktree remove .worktrees/pro-team-gaps
git worktree remove .worktrees/enterprise-gaps
git branch -d feat/core-gaps feat/pro-team-gaps feat/enterprise-gaps
```

---

## Instance Startup Messages

Copy-paste these verbatim when launching each instance.

---

### Instance 2 Startup Message (Core Implementer)

```
You are Instance 2, the Core Implementer for SessionForge. Your working directory is:
  C:/Users/Jakeb/sessionforge/.worktrees/core-gaps

This is a git worktree on branch feat/core-gaps. Do not touch any other branch or worktree.

Your task: implement ALL tasks in the plan at:
  C:/Users/Jakeb/sessionforge/docs/plans/2026-03-01-core-gaps.md

REQUIRED: Use the superpowers:subagent-driven-development skill to execute this plan.
- Read the plan file once at the start and extract all 10 tasks.
- For each task: dispatch a fresh implementer subagent → spec reviewer → code quality reviewer.
- Both reviews must pass before moving to the next task.
- Every task ends with a git commit.

When all 10 tasks are complete and committed, report back: "Instance 2 complete — feat/core-gaps ready for merge gate."

Do not push or merge. The Orchestrator handles merging.
```

---

### Instance 3 Startup Message (Pro/Team Implementer)

```
You are Instance 3, the Pro/Team Implementer for SessionForge. Your working directory is:
  C:/Users/Jakeb/sessionforge/.worktrees/pro-team-gaps

This is a git worktree on branch feat/pro-team-gaps. Do not touch any other branch or worktree.

Your task: implement ALL tasks in the plan at:
  C:/Users/Jakeb/sessionforge/docs/plans/2026-03-01-pro-team-gaps.md

REQUIRED: Use the superpowers:subagent-driven-development skill to execute this plan.
- Read the plan file once at the start and extract all 8 tasks.
- For each task: dispatch a fresh implementer subagent → spec reviewer → code quality reviewer.
- Both reviews must pass before moving to the next task.
- Every task ends with a git commit.

NOTE: You will receive a rebase instruction from the Orchestrator at some point (after feat/core-gaps merges). When you receive it, run the rebase and continue. If you have not yet received it, keep working.

When all 8 tasks are complete and committed, report back: "Instance 3 complete — feat/pro-team-gaps ready for merge gate."

Do not push or merge. The Orchestrator handles merging.
```

---

### Instance 4 Startup Message (Enterprise Implementer)

```
You are Instance 4, the Enterprise Implementer for SessionForge. Your working directory is:
  C:/Users/Jakeb/sessionforge/.worktrees/enterprise-gaps

This is a git worktree on branch feat/enterprise-gaps. Do not touch any other branch or worktree.

Your task: implement ALL tasks in the plan at:
  C:/Users/Jakeb/sessionforge/docs/plans/2026-03-01-enterprise-gaps.md

REQUIRED: Use the superpowers:subagent-driven-development skill to execute this plan.
- Read the plan file once at the start and extract all 8 tasks.
- For each task: dispatch a fresh implementer subagent → spec reviewer → code quality reviewer.
- Both reviews must pass before moving to the next task.
- Every task ends with a git commit.

NOTE: You will receive two rebase instructions from the Orchestrator (once after feat/core-gaps merges, once after feat/pro-team-gaps merges). Run each rebase immediately when you receive it, then continue working.

When all 8 tasks are complete and committed, report back: "Instance 4 complete — feat/enterprise-gaps ready for merge gate."

Do not push or merge. The Orchestrator handles merging.
```

---

## Conflict Surface Map

These files are touched by multiple branches — verify no conflicts at merge time:

| File                                               | Core                          | Pro/Team                              | Enterprise                                                              | Risk                                                                                                                        |
| -------------------------------------------------- | ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/db/schema/index.ts`                  | Adds `notifications` table    | Adds `webhooks`, `webhook_deliveries` | Adds `sso_configs`, `audit_logs`, `ip_allowlists`, `session_recordings` | **High** — all three modify this file. Each adds tables at the END. Merge order prevents conflicts as long as all appended. |
| `apps/web/package.json`                            | Adds xterm.js packages        | Adds `@google-cloud/storage`          | Adds `@node-saml/node-saml`, `asciinema-player`, `ip-cidr`              | **Medium** — adding different keys, no overlap.                                                                             |
| `apps/web/src/components/layout/Header.tsx`        | Adds notification bell wiring | No change                             | No change                                                               | **Low** — only Core touches it.                                                                                             |
| `apps/web/src/middleware.ts`                       | No change                     | No change                             | Adds IP allowlist check                                                 | **Low** — only Enterprise touches it.                                                                                       |
| `apps/web/src/app/api/sessions/[id]/logs/route.ts` | No change                     | Adds GCS fallback                     | No change                                                               | **Low** — only Pro/Team touches it.                                                                                         |

**Resolution rule for `schema/index.ts` conflicts:** Always keep both table blocks. The file grows by appending — there should be no overlapping edits if each branch only adds tables after the last existing table definition.

---

## QA Runbook Integration Per Branch

Instance 5 runs the full 9-step qa-runbook after each branch merge. Key tests relevant to each branch:

| Branch                 | Critical QA Steps                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feat/core-gaps`       | Step 1 (unit — xterm import, notifications routes), Step 2 (auth validator — delete account flow), Step 3 (UX flows — notifications panel, terminal renders) |
| `feat/pro-team-gaps`   | Step 1 (unit — webhook CRUD, GCS archival), Step 4 (API contracts — webhook endpoints), Step 5 (security — webhook HMAC signing)                             |
| `feat/enterprise-gaps` | Step 1 (unit — SSO config, audit log, IP allowlist), Step 2 (auth — SSO OIDC flow), Step 5 (security — IP allowlist bypass attempt)                          |

---

## Rollback Plan

If any QA step is NO-GO after a merge:

```bash
# Identify the merge commit SHA
git log --oneline -5

# Revert the merge commit (creates a new revert commit, safe for shared history)
git revert -m 1 <merge-commit-sha>
git push origin main

# Notify the responsible instance to fix the failing tests
# Re-run the merge gate after fixes are committed
```

Do NOT use `git reset --hard` on `main` — it rewrites shared history.

---

## Estimated Timeline

| Phase                                          | Duration     | Bottleneck                           |
| ---------------------------------------------- | ------------ | ------------------------------------ |
| Phase 1: Launch                                | 10 min       | Orchestrator setup                   |
| Phase 2: Development (all 3 branches parallel) | 4–6 hours    | Longest branch (enterprise, 8 tasks) |
| Phase 3: Core merge gate                       | 30 min       | QA runbook (Instance 5)              |
| Phase 4: Pro/team merge gate                   | 30 min       | QA runbook (Instance 5)              |
| Phase 5: Enterprise merge gate                 | 30 min       | QA runbook (Instance 5)              |
| Phase 6: Production deploy                     | 15 min       | GitHub Actions pipeline              |
| **Total**                                      | **~7 hours** | vs ~3 days sequential                |

---

## Staging URL

Set before Phase 1 launch. Cloud Run staging service is `sessionforge-staging` in `us-central1`.

```bash
gcloud run services describe sessionforge-staging \
  --region=us-central1 \
  --format="value(status.url)"
```

Paste the URL into each QA Agent startup message before dispatching.
