'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2, Users, Save, CreditCard, Check, Infinity } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

const orgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
})

type OrgFormData = z.infer<typeof orgSchema>

const PLANS = [
  {
    name: 'Free',
    price: 0,
    machines: 1,
    sessions: 3,
    current: false,
  },
  {
    name: 'Pro',
    price: 19,
    machines: 5,
    sessions: -1,
    current: true,
  },
  {
    name: 'Team',
    price: 49,
    machines: 20,
    sessions: -1,
    current: false,
  },
  {
    name: 'Enterprise',
    price: 199,
    machines: -1,
    sessions: -1,
    current: false,
  },
]

export default function OrgSettingsPage() {
  const [isSaving, setIsSaving] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<OrgFormData>({
    resolver: zodResolver(orgSchema),
    defaultValues: { name: 'My Organization', slug: 'my-org' },
  })

  async function saveOrg(data: OrgFormData) {
    setIsSaving(true)
    try {
      // STUB: PATCH /api/org { name: data.name, slug: data.slug }
      await new Promise((r) => setTimeout(r, 800))
      toast.success('Organization settings saved!')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
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
            {[
              { name: 'Perry Bailes', email: 'perry@example.com', role: 'Owner' },
            ].map((member) => (
              <div key={member.email} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 text-sm font-medium text-purple-400">
                    {member.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{member.name}</p>
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
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-4 transition-colors ${
                  plan.current
                    ? 'border-purple-500 bg-purple-500/5'
                    : 'border-[#1e1e2e] hover:border-[#2a2a3e]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-white text-sm">{plan.name}</span>
                  {plan.current && (
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
                {!plan.current && (
                  <Button
                    size="sm"
                    variant={plan.name === 'Enterprise' ? 'outline' : 'default'}
                    className="w-full mt-3"
                    onClick={() => {
                      // STUB: Redirect to Stripe checkout
                      toast.info(`Redirecting to ${plan.name} checkout...`)
                    }}
                  >
                    {plan.name === 'Enterprise' ? 'Contact Sales' : `Upgrade to ${plan.name}`}
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-[#1e1e2e]">
            <p className="text-xs text-gray-500">
              Need to manage invoices or update payment info?{' '}
              <button
                onClick={() => {
                  // STUB: Redirect to Stripe billing portal
                  toast.info('Redirecting to billing portal...')
                }}
                className="text-purple-400 hover:text-purple-300 transition-colors"
              >
                Open billing portal →
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
