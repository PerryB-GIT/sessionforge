'use client'

import { ArrowRight, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface UpgradePromptProps {
  resource: 'machines' | 'sessions' | 'api_access' | 'team'
  className?: string
  compact?: boolean
}

const UPGRADE_MESSAGES = {
  machines: {
    title: 'Machine limit reached',
    description: 'Upgrade to Pro to connect up to 5 machines, or Team for 20.',
    cta: 'Upgrade to Pro — $19/mo',
  },
  sessions: {
    title: 'Session limit reached',
    description: 'You\'ve hit your 3-session limit. Upgrade to Pro for unlimited sessions.',
    cta: 'Upgrade to Pro — $19/mo',
  },
  api_access: {
    title: 'API access requires Pro',
    description: 'API access, webhooks, and priority support are available on Pro and above.',
    cta: 'Upgrade to Pro — $19/mo',
  },
  team: {
    title: 'Team features require Team plan',
    description: 'Shared sessions, RBAC, and team invites are available on the Team plan.',
    cta: 'Upgrade to Team — $49/mo',
  },
}

export function UpgradePrompt({ resource, className, compact = false }: UpgradePromptProps) {
  const msg = UPGRADE_MESSAGES[resource]

  if (compact) {
    return (
      <div className={cn(
        'flex items-center justify-between rounded-lg bg-purple-500/5 border border-purple-500/20 px-3 py-2',
        className
      )}>
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-purple-400 shrink-0" />
          <span className="text-xs text-purple-300">{msg.title}</span>
        </div>
        <Button size="sm" className="h-6 text-xs px-2 shrink-0">
          Upgrade
        </Button>
      </div>
    )
  }

  return (
    <div className={cn(
      'rounded-xl border border-purple-500/20 bg-purple-500/5 p-5',
      className
    )}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
          <Zap className="h-4 w-4 text-purple-400" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-white mb-0.5">{msg.title}</h4>
          <p className="text-xs text-gray-400 mb-3">{msg.description}</p>
          <Button size="sm">
            {msg.cta}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
