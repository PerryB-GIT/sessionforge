import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { MachineStatus, SessionStatus } from '@/store'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
        secondary: 'bg-[#1e1e2e] text-gray-400 border border-[#2a2a3e]',
        success: 'bg-green-500/10 text-green-400 border border-green-500/20',
        warning: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
        destructive: 'bg-red-500/10 text-red-400 border border-red-500/20',
        outline: 'border border-[#1e1e2e] text-gray-400',
        info: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

// Status-specific badge components
export function MachineStatusBadge({ status }: { status: MachineStatus }) {
  const config = {
    online: { variant: 'success' as const, label: 'Online', dot: 'bg-green-400' },
    offline: { variant: 'secondary' as const, label: 'Offline', dot: 'bg-gray-500' },
    error: { variant: 'warning' as const, label: 'Error', dot: 'bg-yellow-400' },
  }
  const { variant, label, dot } = config[status]
  return (
    <Badge variant={variant}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${status === 'online' ? 'animate-pulse' : ''}`} />
      {label}
    </Badge>
  )
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const config = {
    running: { variant: 'success' as const, label: 'Running', dot: 'bg-green-400' },
    stopped: { variant: 'secondary' as const, label: 'Stopped', dot: 'bg-gray-500' },
    crashed: { variant: 'destructive' as const, label: 'Crashed', dot: 'bg-red-400' },
    paused: { variant: 'warning' as const, label: 'Paused', dot: 'bg-yellow-400' },
  }
  const { variant, label, dot } = config[status]
  return (
    <Badge variant={variant}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </Badge>
  )
}

export { Badge, badgeVariants }
