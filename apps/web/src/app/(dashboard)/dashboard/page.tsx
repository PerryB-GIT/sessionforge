'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Monitor, Terminal, Activity, TrendingUp, ArrowRight, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MachineStatusBadge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { SessionList } from '@/components/sessions/SessionList'
import { useMachines } from '@/hooks/useMachines'
import { useSessions } from '@/hooks/useSessions'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useStore } from '@/store'
import { formatRelativeTime } from '@/lib/utils'

const PLAN_LIMITS = {
  free: { machines: 1, sessions: 3 },
  pro: { machines: 5, sessions: -1 },
  team: { machines: 20, sessions: -1 },
  enterprise: { machines: -1, sessions: -1 },
} as const

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ElementType
  description?: string
  trend?: string
  color?: string
}

function StatCard({ title, value, icon: Icon, description, trend, color = 'text-purple-400' }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 mb-1">{title}</p>
            <div className="text-2xl font-bold text-white">{value}</div>
            {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
          </div>
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e1e2e]`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-3 text-xs text-green-400">
            <TrendingUp className="h-3 w-3" />
            <span>{trend}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { machines, isLoading: machinesLoading } = useMachines()
  const { sessions, isLoading: sessionsLoading } = useSessions()
  useWebSocket() // Initialize WS connection for real-time updates

  const user = useStore((s) => s.user)
  const plan = (user?.plan ?? 'free') as keyof typeof PLAN_LIMITS
  const limits = PLAN_LIMITS[plan]

  const onlineMachines = machines.filter((m) => m.status === 'online')
  const activeSessions = sessions.filter((s) => s.status === 'running')
  const recentSessions = sessions.slice(0, 5)
  const topMachines = machines.slice(0, 5)

  const machineUsagePct = limits.machines === -1 ? 0 : (machines.length / limits.machines) * 100
  const sessionUsagePct =
    limits.sessions === -1 ? 0 : (activeSessions.length / limits.sessions) * 100

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Welcome banner */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Overview</h2>
          <p className="text-sm text-gray-400">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Link
          href="/sessions"
          className="inline-flex items-center justify-center gap-2 rounded-lg text-xs font-medium transition-all h-7 px-3 bg-purple-500 text-white hover:bg-purple-600 shadow-lg shadow-purple-500/20"
        >
          <Plus className="h-4 w-4" />
          New Session
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Machines"
          value={machines.length}
          icon={Monitor}
          description={limits.machines === -1 ? 'Unlimited plan' : `${limits.machines} max on ${plan}`}
          color="text-purple-400"
        />
        <StatCard
          title="Online Now"
          value={onlineMachines.length}
          icon={Activity}
          description={`${machines.length - onlineMachines.length} offline`}
          color="text-green-400"
        />
        <StatCard
          title="Active Sessions"
          value={activeSessions.length}
          icon={Terminal}
          description={limits.sessions === -1 ? 'Unlimited' : `${limits.sessions} max`}
          color="text-blue-400"
        />
        <StatCard
          title="Plan"
          value={plan.charAt(0).toUpperCase() + plan.slice(1)}
          icon={TrendingUp}
          description={`${machines.length}/${limits.machines === -1 ? '∞' : limits.machines} machines`}
          color="text-yellow-400"
        />
      </div>

      {/* Content grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Machine status mini-list */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Machines</CardTitle>
              <Link
                href="/machines"
                className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {machinesLoading ? (
              <div className="space-y-0">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3 border-t border-[#1e1e2e] animate-pulse">
                    <div className="h-6 w-6 rounded bg-[#1e1e2e]" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3 w-24 rounded bg-[#1e1e2e]" />
                      <div className="h-2.5 w-16 rounded bg-[#1e1e2e]" />
                    </div>
                    <div className="h-5 w-14 rounded-full bg-[#1e1e2e]" />
                  </div>
                ))}
              </div>
            ) : topMachines.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-xs text-gray-500">No machines yet</p>
                <Link
                  href="/machines"
                  className="text-xs text-purple-400 hover:text-purple-300 mt-1 inline-block"
                >
                  Add a machine
                </Link>
              </div>
            ) : (
              <div>
                {topMachines.map((machine, i) => (
                  <Link
                    key={machine.id}
                    href={`/machines/${machine.id}`}
                    className={`flex items-center gap-3 px-5 py-3 hover:bg-[#1e1e2e]/50 transition-colors ${
                      i > 0 ? 'border-t border-[#1e1e2e]' : ''
                    }`}
                  >
                    <div
                      className={`h-6 w-6 rounded flex items-center justify-center shrink-0 ${
                        machine.status === 'online' ? 'bg-green-500/10' : 'bg-[#1e1e2e]'
                      }`}
                    >
                      <div
                        className={`h-2 w-2 rounded-full ${
                          machine.status === 'online' ? 'bg-green-400' : 'bg-gray-600'
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{machine.name}</div>
                      <div className="text-xs text-gray-500">{formatRelativeTime(machine.lastSeen)}</div>
                    </div>
                    <MachineStatusBadge status={machine.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent sessions */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Recent Sessions</h3>
            <Link
              href="/sessions"
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <SessionList sessions={recentSessions} isLoading={sessionsLoading} compact />
        </div>
      </div>

      {/* Usage meters */}
      {limits.machines !== -1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Plan Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Machines</span>
                <span className="text-white">
                  {machines.length} / {limits.machines}
                </span>
              </div>
              <Progress
                value={machineUsagePct}
                indicatorClassName={
                  machineUsagePct >= 90 ? 'bg-red-400' : machineUsagePct >= 70 ? 'bg-yellow-400' : 'bg-purple-500'
                }
              />
            </div>
            {limits.sessions !== -1 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Active Sessions</span>
                  <span className="text-white">
                    {activeSessions.length} / {limits.sessions}
                  </span>
                </div>
                <Progress
                  value={sessionUsagePct}
                  indicatorClassName={
                    sessionUsagePct >= 90 ? 'bg-red-400' : sessionUsagePct >= 70 ? 'bg-yellow-400' : 'bg-purple-500'
                  }
                />
              </div>
            )}
            {(machineUsagePct >= 80 || sessionUsagePct >= 80) && (
              <div className="flex items-center justify-between rounded-lg bg-purple-500/5 border border-purple-500/20 px-3 py-2">
                <span className="text-xs text-purple-300">Approaching plan limits</span>
                <Link
                  href="/settings/org"
                  className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                >
                  Upgrade →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
