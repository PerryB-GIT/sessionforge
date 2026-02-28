'use client'

import { useRouter } from 'next/navigation'
import { CheckCircle2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PLAN_LIMITS } from '@sessionforge/shared-types'
import type { PlanTier } from '@sessionforge/shared-types'

interface UpgradeSuccessModalProps {
  open: boolean
  onClose: () => void
  plan: PlanTier
}

export function UpgradeSuccessModal({ open, onClose, plan }: UpgradeSuccessModalProps) {
  const router = useRouter()
  const limits = PLAN_LIMITS[plan]
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1)

  const machineLabel = limits.machines === -1 ? 'Unlimited' : `${limits.machines}`
  const historyLabel = limits.historyDays === 365 ? '1 year' : `${limits.historyDays} days`

  function handleAddMachine() {
    onClose()
    router.push('/machines')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <DialogTitle>You're on {planLabel}</DialogTitle>
          </div>
          <DialogDescription>
            Here's what's unlocked on your new plan:
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 py-2">
          <li className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Machines</span>
            <span className="text-white font-medium">{machineLabel}</span>
          </li>
          <li className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Concurrent sessions</span>
            <span className="text-white font-medium">Unlimited</span>
          </li>
          <li className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Session history</span>
            <span className="text-white font-medium">{historyLabel}</span>
          </li>
          {plan !== 'free' && (
            <li className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Webhooks & API access</span>
              <span className="text-white font-medium">Enabled</span>
            </li>
          )}
        </ul>

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={handleAddMachine} className="w-full">
            Add Your First Machine
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-gray-400">
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
