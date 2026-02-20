'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Building2,
  Key,
  Terminal,
  Monitor,
  PartyPopper,
  Check,
  Copy,
  RefreshCw,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const STEPS = [
  { id: 1, label: 'Organization', icon: Building2 },
  { id: 2, label: 'API Key', icon: Key },
  { id: 3, label: 'Install Agent', icon: Terminal },
  { id: 4, label: 'Verify', icon: Monitor },
  { id: 5, label: 'Done!', icon: PartyPopper },
]

const orgSchema = z.object({
  orgName: z.string().min(2, 'Organization name must be at least 2 characters'),
})

type OrgFormData = z.infer<typeof orgSchema>

const INSTALL_COMMAND = `curl -fsSL https://sessionforge.dev/install.sh | sh`

export function OnboardingWizard() {
  const [step, setStep] = useState(1)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyCopied, setApiKeyCopied] = useState(false)
  const [commandCopied, setCommandCopied] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isCreatingKey, setIsCreatingKey] = useState(false)
  const [isCreatingOrg, setIsCreatingOrg] = useState(false)
  const router = useRouter()

  const { register, handleSubmit, formState: { errors } } = useForm<OrgFormData>({
    resolver: zodResolver(orgSchema),
    defaultValues: { orgName: '' },
  })

  const installCommand = apiKey
    ? INSTALL_COMMAND.replace('SF_API_KEY_PLACEHOLDER', apiKey)
    : INSTALL_COMMAND

  async function handleOrgSubmit(data: OrgFormData) {
    setIsCreatingOrg(true)
    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.orgName }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to create organization')
        return
      }
      toast.success(`Organization "${data.orgName}" created!`)
      setStep(2)
    } finally {
      setIsCreatingOrg(false)
    }
  }

  async function createApiKey() {
    setIsCreatingKey(true)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Onboarding Key', scopes: ['agent:connect'] }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to create API key')
        return
      }
      setApiKey(json.data.key)
      toast.success('API key created! Copy it now — you won\'t see it again.')
    } finally {
      setIsCreatingKey(false)
    }
  }

  async function copyApiKey() {
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    setApiKeyCopied(true)
    toast.success('API key copied!')
    setTimeout(() => setApiKeyCopied(false), 2000)
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(installCommand)
    setCommandCopied(true)
    toast.success('Install command copied!')
    setTimeout(() => setCommandCopied(false), 2000)
  }

  async function verifyConnection() {
    setIsVerifying(true)
    try {
      // Poll /api/machines up to 12 times (30s total) waiting for a machine to appear
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 2500))
        const res = await fetch('/api/machines')
        if (res.ok) {
          const json = await res.json()
          if ((json.data?.total ?? 0) > 0) {
            setStep(5)
            return
          }
        }
      }
      toast.error('No machine detected. Make sure the agent is running, then try again.')
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Steps indicator */}
      <div className="flex items-center justify-between mb-10">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const isCompleted = step > s.id
          const isCurrent = step === s.id
          return (
            <div key={s.id} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all',
                    isCompleted
                      ? 'bg-green-500 border-green-500'
                      : isCurrent
                      ? 'bg-purple-500 border-purple-500'
                      : 'bg-[#111118] border-[#1e1e2e]'
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4 text-white" />
                  ) : (
                    <Icon
                      className={cn(
                        'h-4 w-4',
                        isCurrent ? 'text-white' : 'text-gray-600'
                      )}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium',
                    isCurrent ? 'text-white' : isCompleted ? 'text-green-400' : 'text-gray-600'
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-px w-12 sm:w-16 mx-2 -translate-y-3',
                    step > s.id ? 'bg-green-500' : 'bg-[#1e1e2e]'
                  )}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-6 sm:p-8">
        {/* Step 1: Name your org */}
        {step === 1 && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                <Building2 className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Welcome to SessionForge</h2>
                <p className="text-sm text-gray-400">Let&apos;s get you set up in about 2 minutes.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit(handleOrgSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="orgName">Organization Name</Label>
                <Input
                  id="orgName"
                  placeholder="e.g. Acme Corp, Personal, My Team"
                  error={errors.orgName?.message}
                  {...register('orgName')}
                />
                <p className="text-xs text-gray-500">
                  This can be changed later in Organization Settings.
                </p>
              </div>

              <Button type="submit" isLoading={isCreatingOrg} className="w-full sm:w-auto">
                Create Organization
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          </div>
        )}

        {/* Step 2: Create API key */}
        {step === 2 && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                <Key className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Create Your First API Key</h2>
                <p className="text-sm text-gray-400">This key lets the agent connect to your account.</p>
              </div>
            </div>

            {!apiKey ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] p-4">
                  <p className="text-xs text-gray-400">
                    The API key will only be shown once. Make sure to copy it before continuing.
                  </p>
                </div>
                <Button onClick={createApiKey} isLoading={isCreatingKey}>
                  <Key className="h-4 w-4" />
                  Generate API Key
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-[#0a0a0f] border border-green-500/20 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-green-400">Your API Key (copy now!)</span>
                    <button
                      onClick={copyApiKey}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      {apiKeyCopied ? (
                        <><Check className="h-3.5 w-3.5 text-green-400" /> Copied!</>
                      ) : (
                        <><Copy className="h-3.5 w-3.5" /> Copy</>
                      )}
                    </button>
                  </div>
                  <code className="text-xs font-mono text-purple-300 break-all">{apiKey}</code>
                </div>

                <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-3">
                  <p className="text-xs text-yellow-400">
                    <strong>Important:</strong> This key will not be shown again. Store it securely.
                  </p>
                </div>

                <Button onClick={() => setStep(3)} disabled={!apiKeyCopied} className="w-full sm:w-auto">
                  I&apos;ve saved my key
                  <ArrowRight className="h-4 w-4" />
                </Button>
                {!apiKeyCopied && (
                  <p className="text-xs text-gray-500">Copy the key first, then continue.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Install agent */}
        {step === 3 && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                <Terminal className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Install the Agent</h2>
                <p className="text-sm text-gray-400">Run this on the machine you want to manage.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="relative rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] p-4">
                <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap break-all pr-8">
                  {installCommand}
                </pre>
                <button
                  onClick={copyCommand}
                  className="absolute right-3 top-3 rounded p-1.5 text-gray-500 hover:text-white hover:bg-[#1e1e2e] transition-colors"
                >
                  {commandCopied ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>

              <div className="rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] p-3 text-xs text-gray-400">
                <p className="font-medium text-white mb-1">Supports:</p>
                <ul className="space-y-0.5 text-gray-500">
                  <li>Linux (Ubuntu, Debian, CentOS, etc.)</li>
                  <li>macOS (Intel & Apple Silicon)</li>
                  <li>Windows (PowerShell 5+)</li>
                </ul>
              </div>

              <Button onClick={() => setStep(4)}>
                I ran the command
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Verify */}
        {step === 4 && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                <Monitor className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Verify Connection</h2>
                <p className="text-sm text-gray-400">Let&apos;s confirm your machine is connected.</p>
              </div>
            </div>

            <div className="flex flex-col items-center py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1e1e2e] mb-4">
                <Monitor className="h-8 w-8 text-gray-500" />
              </div>
              <p className="text-sm text-gray-400 mb-6 max-w-sm">
                Once the agent is running on your machine, click below. We&apos;ll check for the connection.
              </p>
              <Button onClick={verifyConnection} isLoading={isVerifying}>
                <RefreshCw className="h-4 w-4" />
                {isVerifying ? 'Checking for machine...' : 'Verify Connection'}
              </Button>
              {isVerifying && (
                <p className="text-xs text-gray-500 mt-3">
                  This usually takes a few seconds...
                </p>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Celebrate */}
        {step === 5 && (
          <div className="text-center py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 mx-auto mb-4">
              <PartyPopper className="h-8 w-8 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">
              Your first machine is connected!
            </h2>
            <p className="text-sm text-gray-400 mb-8 max-w-sm mx-auto">
              You&apos;re all set. Head to your dashboard to start managing sessions, monitor metrics, and more.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button onClick={() => router.push('/dashboard')} size="lg">
                Go to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => router.push('/sessions')}
              >
                Start a Session
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
