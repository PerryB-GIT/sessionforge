'use client'

import { Zap, Users, Building2, Check, Infinity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { PlanTier } from '@/store'

const PLAN_LIMITS = {
  free: { machines: 1, sessions: 3 },
  pro: { machines: 5, sessions: -1 },
  team: { machines: 20, sessions: -1 },
  enterprise: { machines: -1, sessions: -1 },
} as const

const PLAN_PRICES = {
  free: 0,
  pro: 19,
  team: 49,
  enterprise: 199,
} as const

const PLAN_ICONS = {
  free: Zap,
  pro: Zap,
  team: Users,
  enterprise: Building2,
}

const PLAN_COLORS = {
  free: 'text-gray-400',
  pro: 'text-purple-400',
  team: 'text-blue-400',
  enterprise: 'text-yellow-400',
}

interface PlanCardProps {
  plan: PlanTier
  machinesUsed: number
  sessionsActive: number
  onUpgrade?: () => void
}

export function PlanCard({ plan, machinesUsed, sessionsActive, onUpgrade }: PlanCardProps) {
  const limits = PLAN_LIMITS[plan]
  const Icon = PLAN_ICONS[plan]
  const color = PLAN_COLORS[plan]

  const machinePercent =
    limits.machines === -1 ? 0 : Math.min((machinesUsed / limits.machines) * 100, 100)
  const sessionPercent =
    limits.sessions === -1 ? 0 : Math.min((sessionsActive / limits.sessions) * 100, 100)

  function usageColor(pct: number) {
    if (pct >= 90) return 'bg-red-400'
    if (pct >= 70) return 'bg-yellow-400'
    return 'bg-purple-500'
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1e1e2e]">
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <CardTitle className="text-base">Current Plan</CardTitle>
          </div>
          <Badge className={`capitalize ${plan === 'pro' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : ''}`}>
            {plan}
          </Badge>
        </div>
        <p className="text-2xl font-bold text-white mt-1">
          {PLAN_PRICES[plan] === 0 ? 'Free' : `$${PLAN_PRICES[plan]}/mo`}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Machines usage */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Machines</span>
            <span className="text-white font-medium">
              {machinesUsed} / {limits.machines === -1 ? <Infinity className="h-4 w-4 inline" /> : limits.machines}
            </span>
          </div>
          {limits.machines !== -1 && (
            <Progress
              value={machinePercent}
              indicatorClassName={usageColor(machinePercent)}
            />
          )}
        </div>

        {/* Sessions usage */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Active Sessions</span>
            <span className="text-white font-medium">
              {sessionsActive} / {limits.sessions === -1 ? <Infinity className="h-4 w-4 inline" /> : limits.sessions}
            </span>
          </div>
          {limits.sessions !== -1 && (
            <Progress
              value={sessionPercent}
              indicatorClassName={usageColor(sessionPercent)}
            />
          )}
        </div>

        {/* Upgrade CTA */}
        {plan !== 'enterprise' && onUpgrade && (
          <Button className="w-full mt-2" size="sm" onClick={onUpgrade}>
            Upgrade to {plan === 'free' ? 'Pro' : plan === 'pro' ? 'Team' : 'Enterprise'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
