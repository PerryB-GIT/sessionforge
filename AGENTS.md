# Multi-Agent Build Rules

## Worktree Assignments

| Worktree | Branch | Agent Role | Owns |
|----------|--------|-----------|------|
| `.worktrees/agent-backend` | `dev/backend` | Backend Architect | `apps/web/src/server/`, `apps/web/src/db/`, API routes |
| `.worktrees/agent-frontend` | `dev/frontend` | Frontend Engineer | `apps/web/src/app/`, `apps/web/src/components/` |
| `.worktrees/agent-desktop` | `dev/desktop` | Agent Developer | `agent/` directory (Go) |
| `.worktrees/agent-infra` | `dev/infra` | DevOps Engineer | `infra/`, Dockerfiles, CI/CD |
| `.worktrees/agent-qa` | `dev/qa` | QA Engineer | `tests/`, E2E, integration tests |

## Rules (STRICTLY ENFORCED)

1. **Each agent works ONLY in its assigned worktree** — never edit files outside your assigned directories
2. **Never push to `main`** — all changes go through PRs
3. **Shared types are READ-ONLY** for all agents except Backend Architect — request changes via PR
4. **No merge conflicts** — if you need a file another agent owns, ask, don't touch
5. **Commit often** — small commits with clear messages
6. **Prefix commits** — `feat:`, `fix:`, `chore:`, `test:`, `docs:`

## Integration Points

- Backend Architect defines API contracts in `packages/shared-types/` 
- Frontend Engineer consumes types, never defines them
- Agent Developer uses ws-protocol types, never modifies them
- Nightly: all dev/* branches merge to `dev/integration` for testing

## On-Demand Specialist Agents

Invoked as needed (work in temporary branches):
- `security-auditor` — auth review, vulnerability scanning
- `performance-agent` — load testing, optimization
- `content-agent` — docs, marketing copy
- `design-agent` — UI polish, Tailwind tokens
- `migration-agent` — schema changes, data moves
