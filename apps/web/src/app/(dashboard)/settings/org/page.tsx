'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2, Users, Save, CreditCard, Check, Infinity } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

type OrgMember = { id: string; name: string | null; email: string; role: string }

function StripeRedirectToasts() {
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('upgraded') === '1') {
      toast.success('Plan upgraded successfully! Welcome to your new plan.')
    }
    if (searchParams.get('canceled') === '1') {
      toast.info('Checkout canceled. Your plan has not changed.')
    }
  }, [searchParams])
  return null
}

const orgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
})

type OrgFormData = z.infer<typeof orgSchema>

const PLANS = [
  { name: 'Free',       price: 0,   machines: 1,  sessions: 3  },
  { name: 'Pro',        price: 19,  machines: 5,  sessions: -1 },
  { name: 'Team',       price: 49,  machines: 20, sessions: -1 },
  { name: 'Enterprise', price: 199, machines: -1, sessions: -1 },
]

export default function OrgSettingsPage() {
  const [isSaving, setIsSaving] = useState(false)
  const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [members, setMembers] = useState<OrgMember[]>([])
  const { data: session } = useSession()
  const currentPlan = (session?.user as { plan?: string } | undefined)?.plan ?? 'free'

  async function handleUpgrade(planName: string) {
    setUpgradingPlan(planName)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planName.toLowerCase() }),
      })
      const { url, error } = await res.json()
      if (error || !url) {
        toast.error(error ?? 'Failed to start checkout')
        return
      }
      window.location.href = url
    } catch {
      toast.error('Failed to start checkout')
    } finally {
      setUpgradingPlan(null)
    }
  }

  async function handleBillingPortal() {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const { url, error } = await res.json()
      if (error || !url) {
        toast.error(error ?? 'No billing account found')
        return
      }
      window.location.href = url
    } catch {
      toast.error('Failed to open billing portal')
    } finally {
      setPortalLoading(false)
    }
  }

  const { register, handleSubmit, reset, formState: { errors } } = useForm<OrgFormData>({
    resolver: zodResolver(orgSchema),
    defaultValues: { name: '', slug: '' },
  })

  useEffect(() => {
    fetch('/api/org')
      .then((r) => r.json())
      .then((json) => {
        if (json.data) reset({ name: json.data.name, slug: json.data.slug })
      })
      .catch(() => {})

    fetch('/api/org/members')
      .then((r) => r.json())
      .then((json) => { if (json.data) setMembers(json.data) })
      .catch(() => {})
  }, [reset])

  async function saveOrg(data: OrgFormData) {
    setIsSaving(true)
    try {
      const res = await fetch('/api/org', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, slug: data.slug }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to save settings')
        return
      }
      toast.success('Organization settings saved!')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Suspense>
        <StripeRedirectToasts />
      </Suspense>
      <div>
        <h2 className="text-lg font-semibold text-white">Organization Settings</h2>
        <p className="text-sm text-gray-400">Manage your organization profile and billing</p>
      </div>

      {/* Org info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">Organization</CardTitle>
          </div>
          <CardDescription>Update your organization name and URL slug</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(saveOrg)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                error={errors.name?.message}
                {...register('name')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">URL Slug</Label>
              <div className="flex items-center gap-0">
                <span className="flex h-9 items-center rounded-l-lg border border-r-0 border-[#1e1e2e] bg-[#1e1e2e] px-3 text-xs text-gray-500 shrink-0">
                  app.sessionforge.io/
                </span>
                <Input
                  id="slug"
                  className="rounded-l-none"
                  error={errors.slug?.message}
                  {...register('slug')}
                />
              </div>
            </div>
            <Button type="submit" size="sm" isLoading={isSaving}>
              <Save className="h-4 w-4" />
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Team members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-400" />
              <CardTitle className="text-base">Team Members</CardTitle>
            </div>
            <Button size="sm">Invite Member</Button>
          </div>
          <CardDescription>Manage access to your organization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {members.length === 0 ? (
              <p className="text-sm text-gray-500">No members found.</p>
            ) : members.map((member) => (
              <div key={member.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 text-sm font-medium text-purple-400">
                    {(member.name ?? member.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{member.name ?? member.email.split('@')[0]}</p>
                    <p className="text-xs text-gray-500">{member.email}</p>
                  </div>
                </div>
                <Badge variant="secondary">{member.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Billing / Plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">Plan & Billing</CardTitle>
          </div>
          <CardDescription>Manage your subscription</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3">
            {PLANS.map((plan) => {
              const isCurrent = plan.name.toLowerCase() === currentPlan
              return (
              <div
                key={plan.name}
                className={`rounded-xl border p-4 transition-colors ${
                  isCurrent
                    ? 'border-purple-500 bg-purple-500/5'
                    : 'border-[#1e1e2e] hover:border-[#2a2a3e]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-white text-sm">{plan.name}</span>
                  {isCurrent && (
                    <Badge variant="default" className="text-xs">Current</Badge>
                  )}
                </div>
                <div className="text-xl font-bold text-white mb-2">
                  {plan.price === 0 ? 'Free' : `$${plan.price}/mo`}
                </div>
                <ul className="space-y-1 text-xs text-gray-400">
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-green-400" />
                    {plan.machines === -1 ? <><Infinity className="h-3 w-3" /> machines</> : `${plan.machines} machine${plan.machines !== 1 ? 's' : ''}`}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3 w-3 text-green-400" />
                    {plan.sessions === -1 ? 'Unlimited sessions' : `${plan.sessions} sessions`}
                  </li>
                </ul>
                {!isCurrent && (
                  <Button
                    size="sm"
                    variant={plan.name === 'Enterprise' ? 'outline' : 'default'}
                    className="w-full mt-3"
                    isLoading={upgradingPlan === plan.name}
                    onClick={() => {
                      if (plan.name === 'Enterprise') {
                        window.open('mailto:sales@sessionforge.dev?subject=Enterprise%20Plan%20Inquiry', '_blank')
                      } else {
                        handleUpgrade(plan.name)
                      }
                    }}
                  >
                    {plan.name === 'Enterprise' ? 'Contact Sales' : `Upgrade to ${plan.name}`}
                  </Button>
                )}
              </div>
            )
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-[#1e1e2e]">
            <p className="text-xs text-gray-500">
              Need to manage invoices or update payment info?{' '}
              <button
                onClick={handleBillingPortal}
                disabled={portalLoading}
                className="text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50"
              >
                {portalLoading ? 'Loading...' : 'Open billing portal →'}
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
