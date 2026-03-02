# Process Discovery + Adopt — Implementation Plan

**Date:** 2026-03-02
**Feature:** Agent-side process scanning + Dashboard "Adopt" flow

---

## Design Summary

The Go agent scans the host for running processes every 10s (down from 30s heartbeat).
Discovered processes are piggy-backed onto the heartbeat message.
The server fans them out to the dashboard WS as part of `machine_updated`.
The dashboard stores them in Zustand and shows an "Unmanaged Processes" banner on the
Sessions page. Clicking "Adopt" opens StartSessionDialog pre-filled with command + workdir.

**Key constraints:**

- Fully silent — agent runs as Windows SCM service, no console, no popups
- Zero new Go dependencies (gopsutil/v3/process already in go.mod)
- Zero DB schema changes
- Zero new WS message types (piggybacked on existing heartbeat + machine_updated)

---

## Files Changed

| File                                                      | Action                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `agent/internal/connection/heartbeat.go`                  | MODIFY — 10s interval, add process scanning, extend heartbeat msg                     |
| `agent/internal/session/registry.go`                      | READ — need GetAllPIDs() method or equivalent                                         |
| `agent/internal/session/manager.go`                       | READ — expose PIDs of managed sessions to exclude them                                |
| `packages/shared-types/src/ws-protocol.ts`                | MODIFY — add DiscoveredProcess type, extend heartbeat + machine_updated               |
| `apps/web/server.js`                                      | MODIFY — pass discoveredProcesses through heartbeat handler + machine_updated publish |
| `apps/web/src/store/index.ts`                             | MODIFY — add discoveredProcesses to Machine interface                                 |
| `apps/web/src/hooks/useWebSocket.ts`                      | MODIFY — handle discoveredProcesses in machine_updated                                |
| `apps/web/src/components/sessions/StartSessionDialog.tsx` | MODIFY — add defaultCommand + defaultWorkdir props                                    |
| `apps/web/src/app/(dashboard)/sessions/page.tsx`          | MODIFY — add DiscoveredProcessesBanner component                                      |

---

## Step-by-Step Plan

### Step 1 — `packages/shared-types/src/ws-protocol.ts`

Add `DiscoveredProcess` interface. Extend `AgentMessage` heartbeat. Extend `CloudToBrowserMessage` machine_updated.

```ts
export interface DiscoveredProcess {
  pid: number
  name: string // e.g. "claude", "bash"
  cmdline: string // full command line e.g. "claude --dangerously-skip-permissions"
  workdir: string // cwd of process
}

// In AgentMessage heartbeat union member, add:
// discoveredProcesses?: DiscoveredProcess[]

// In CloudToBrowserMessage machine_updated machine object, add:
// discoveredProcesses?: DiscoveredProcess[]
```

### Step 2 — `agent/internal/connection/heartbeat.go`

- Change `heartbeatInterval` from `30 * time.Second` to `10 * time.Second`
- Import `github.com/shirou/gopsutil/v3/process` (already in go.mod, zero new dep)
- Add `DiscoveredProcess` struct matching ws-protocol
- Add `SessionPIDLister` interface (method: `ManagedPIDs() map[int]bool`)
- Extend `heartbeatMsg` with `DiscoveredProcesses []DiscoveredProcess`
- Add `scanProcesses(managedPIDs map[int]bool) []DiscoveredProcess` function:
  - List all running processes via gopsutil
  - Filter: only names in allowList (claude, bash, zsh, sh, powershell, cmd)
  - Exclude PIDs in managedPIDs map
  - For each match: get Cmdline(), Cwd() (best-effort, empty on error)
  - Return slice (empty slice if none)
- Update `RunHeartbeat` signature to accept `SessionPIDLister`
- Call `scanProcesses()` each tick, include result in heartbeat msg

### Step 3 — `agent/internal/session/manager.go`

- Add `ManagedPIDs() map[int]bool` method that returns a set of all PIDs currently tracked
  by managed sessions (reads from registry, filters out zero-PIDs)

### Step 4 — `agent/internal/cli/root.go`

- Update `go connection.RunHeartbeat(...)` call to pass `mgr` (Manager already satisfies Count(),
  need to also satisfy ManagedPIDs() after Step 3)

### Step 5 — `apps/web/server.js`

In the `heartbeat` case of `handleAgentMessage`:

- Destructure `discoveredProcesses` from `msg` alongside existing fields
- Include `discoveredProcesses` in the Redis metrics cache JSON
- Include `discoveredProcesses` in the `machine_updated` publish to dashboard

In `pushInitialMetrics()` (dashboard WS connect):

- Include `discoveredProcesses` from cached metrics when building `machine_updated` message

### Step 6 — `apps/web/src/store/index.ts`

Add to `Machine` interface:

```ts
discoveredProcesses?: DiscoveredProcess[]
```

Import `DiscoveredProcess` from shared-types or define inline.

### Step 7 — `apps/web/src/hooks/useWebSocket.ts`

In `machine_updated` handler, also extract and pass `discoveredProcesses`:

```ts
updateMachine(m.id, {
  ...existing fields...,
  discoveredProcesses: m.discoveredProcesses,
})
```

### Step 8 — `apps/web/src/components/sessions/StartSessionDialog.tsx`

Add props:

```ts
interface StartSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultMachineId?: string
  defaultCommand?: string // NEW
  defaultWorkdir?: string // NEW
}
```

Pass `defaultCommand` and `defaultWorkdir` into `useForm` defaultValues.
Use `useEffect` to reset form when these change (so Adopt always pre-fills fresh).

### Step 9 — `apps/web/src/app/(dashboard)/sessions/page.tsx`

Add `DiscoveredProcessesBanner` inline component (or as a separate file in components/sessions/).

- Uses `useMachines()` from Zustand (via `useStore`)
- Collects all `machine.discoveredProcesses` across all online machines
- If none: render nothing
- If some: render a collapsible card/banner above SessionList:

  ```
  [Radar icon] X unmanaged process(es) found on your machines
  [Expand/collapse]

  When expanded, table rows:
  Machine | Process | Command | Working Dir | [Adopt] button
  ```

- "Adopt" button: sets `adoptTarget` state, opens StartSessionDialog with
  `defaultMachineId`, `defaultCommand`, `defaultWorkdir` pre-filled

---

## Execution Order

1. Step 1: ws-protocol.ts (types first, everything else builds on this)
2. Step 2: heartbeat.go (core agent change)
3. Step 3: manager.go (ManagedPIDs method)
4. Step 4: root.go (wire up new interface)
5. Build + test agent: `cd agent && go build ./...`
6. Step 5: server.js (pass through discoveredProcesses)
7. Step 6: store/index.ts
8. Step 7: useWebSocket.ts
9. Step 8: StartSessionDialog.tsx
10. Step 9: sessions/page.tsx
11. `npm run type-check` — must pass clean
12. Rebuild agent binary for Windows
13. Commit + push + deploy

---

## Verification

- Agent builds cleanly (`go build ./...`)
- Type-check passes (`npm run type-check`)
- On live machine: within 10s, dashboard Sessions page shows "Unmanaged Processes" banner
  with running claude/bash processes listed
- Click "Adopt" → StartSessionDialog opens pre-filled → start → managed session appears
- Banner disappears for that process after adoption (it now has a managed session,
  and heartbeat no longer reports it as unmanaged once the agent tracks it)
