'use client'

import { useState } from 'react'
import { Plus, Trash2, Copy, Check, Key, AlertTriangle, Clock, Shield } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useStore, type ApiKey } from '@/store'
import { formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'

const schema = z.object({
  name: z.string().min(1, 'Key name is required').max(50),
})

type FormData = z.infer<typeof schema>

// STUB: Mock API keys for development
const MOCK_KEYS: ApiKey[] = [
  {
    id: 'key_01',
    name: 'Production Agent',
    prefix: 'sf_live_a1b2',
    lastUsed: new Date(Date.now() - 300000),
    createdAt: new Date('2024-01-15'),
    scopes: ['agent:connect', 'session:read', 'session:write'],
  },
  {
    id: 'key_02',
    name: 'CI/CD Pipeline',
    prefix: 'sf_live_c3d4',
    lastUsed: new Date(Date.now() - 86400000),
    createdAt: new Date('2024-02-01'),
    scopes: ['session:read'],
  },
]

export default function ApiKeysPage() {
  const { apiKeys, setApiKeys, addApiKey, removeApiKey } = useStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [isRevoking, setIsRevoking] = useState(false)

  // Load mock keys on first render
  useState(() => {
    if (apiKeys.length === 0) setApiKeys(MOCK_KEYS)
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onCreateKey(data: FormData) {
    setIsCreating(true)
    try {
      // STUB: POST /api/keys { name: data.name, scopes: [...] }
      await new Promise((r) => setTimeout(r, 800))
      const fullKey = `sf_live_${Array.from({ length: 32 }, () =>
        '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]
      ).join('')}`
      const prefix = fullKey.slice(0, 14)

      const newApiKey: ApiKey = {
        id: `key_${Date.now()}`,
        name: data.name,
        prefix,
        lastUsed: null,
        createdAt: new Date(),
        scopes: ['agent:connect', 'session:read', 'session:write'],
      }

      addApiKey(newApiKey)
      setNewKey(fullKey)
      reset()
    } finally {
      setIsCreating(false)
    }
  }

  async function copyKey() {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey)
    setCopied(true)
    toast.success('API key copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  function closeCreateDialog() {
    setCreateOpen(false)
    setNewKey(null)
    setCopied(false)
    reset()
  }

  async function revokeKey(id: string) {
    setIsRevoking(true)
    try {
      // STUB: DELETE /api/keys/:id
      await new Promise((r) => setTimeout(r, 600))
      removeApiKey(id)
      toast.success('API key revoked')
      setRevokeId(null)
    } finally {
      setIsRevoking(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">API Keys</h2>
          <p className="text-sm text-gray-400">{apiKeys.length} key{apiKeys.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create API Key
        </Button>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
        <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
        <p className="text-sm text-yellow-300">
          API keys grant full access to your account. Never share them publicly or commit them to source control.
          Store them securely using environment variables or a secrets manager.
        </p>
      </div>

      {/* Keys table */}
      {apiKeys.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1e1e2e] py-16">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1e1e2e] mb-3">
            <Key className="h-5 w-5 text-gray-600" />
          </div>
          <h3 className="text-sm font-medium text-white mb-1">No API keys yet</h3>
          <p className="text-xs text-gray-500 mb-4">Create an API key to connect agents and automate workflows</p>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create your first key
          </Button>
        </div>
      ) : (
        <Card>
          <div>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_140px_120px_120px_80px] gap-4 px-5 py-2.5 border-b border-[#1e1e2e] text-xs font-medium text-gray-500">
              <span>Name</span>
              <span>Key Prefix</span>
              <span>Last Used</span>
              <span>Created</span>
              <span />
            </div>

            {/* Rows */}
            {apiKeys.map((key, i) => (
              <div
                key={key.id}
                className={`grid grid-cols-[1fr_140px_120px_120px_80px] items-center gap-4 px-5 py-3.5 ${
                  i > 0 ? 'border-t border-[#1e1e2e]' : ''
                }`}
              >
                {/* Name + scopes */}
                <div>
                  <div className="text-sm font-medium text-white">{key.name}</div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {key.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="text-[10px] rounded px-1.5 py-0.5 bg-[#1e1e2e] text-gray-500 font-mono"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Prefix */}
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-gray-600 shrink-0" />
                  <span className="font-mono text-xs text-gray-400">{key.prefix}***</span>
                </div>

                {/* Last used */}
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(key.lastUsed)}
                </div>

                {/* Created */}
                <div className="text-xs text-gray-500">
                  {formatRelativeTime(key.createdAt)}
                </div>

                {/* Revoke */}
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setRevokeId(key.id)}
                    className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={closeCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-purple-400" />
              Create API Key
            </DialogTitle>
            <DialogDescription>
              Give your key a descriptive name so you can identify it later.
            </DialogDescription>
          </DialogHeader>

          {!newKey ? (
            <form onSubmit={handleSubmit(onCreateKey)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="keyName">Key Name</Label>
                <Input
                  id="keyName"
                  placeholder="e.g. Production Server, Local Dev, CI/CD"
                  error={errors.name?.message}
                  {...register('name')}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeCreateDialog}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isCreating}>
                  Generate Key
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-[#0a0a0f] border border-green-500/20 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-green-400">Your API Key — Copy now!</span>
                  <button
                    onClick={copyKey}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    {copied ? (
                      <><Check className="h-3.5 w-3.5 text-green-400" /> Copied!</>
                    ) : (
                      <><Copy className="h-3.5 w-3.5" /> Copy</>
                    )}
                  </button>
                </div>
                <code className="text-xs font-mono text-purple-300 break-all">{newKey}</code>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-3">
                <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-300">
                  This key will not be shown again. Store it in a secure location now.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={closeCreateDialog} variant={copied ? 'default' : 'outline'}>
                  {copied ? 'Done' : 'Close (key won\'t be shown again)'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirm dialog */}
      <Dialog open={!!revokeId} onOpenChange={() => setRevokeId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API Key</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke{' '}
              <strong className="text-white">
                {apiKeys.find((k) => k.id === revokeId)?.name}
              </strong>
              ? Any agents or integrations using this key will lose access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              isLoading={isRevoking}
              onClick={() => revokeId && revokeKey(revokeId)}
            >
              <Trash2 className="h-4 w-4" />
              Revoke Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
