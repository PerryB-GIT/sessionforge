'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

const VALID_EVENTS = [
  { value: 'session.started', label: 'Session started' },
  { value: 'session.stopped', label: 'Session stopped' },
  { value: 'session.crashed', label: 'Session crashed' },
  { value: 'machine.online', label: 'Machine online' },
  { value: 'machine.offline', label: 'Machine offline' },
]

interface Webhook {
  id: string
  url: string
  events: string[]
  enabled: boolean
  createdAt: string
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/webhooks')
    const j = await res.json()
    setWebhooks(j.data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function create() {
    setIsCreating(true)
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl, events: selectedEvents }),
      })
      const j = await res.json()
      if (!res.ok) {
        toast.error(j.error?.message ?? 'Failed to create webhook')
        return
      }
      setNewSecret(j.data.secret)
      setNewUrl('')
      setSelectedEvents([])
      await load()
    } finally {
      setIsCreating(false)
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to delete webhook')
      return
    }
    setWebhooks((prev) => prev.filter((w) => w.id !== id))
    toast.success('Webhook removed')
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Webhooks</h2>
          <p className="text-sm text-gray-400">
            Receive HTTP POST events when sessions and machines change state
          </p>
        </div>
        <Dialog
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o)
            if (!o) setNewSecret(null)
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add Endpoint
            </Button>
          </DialogTrigger>
          <DialogContent className="border-[#1e1e2e] bg-[#0a0a0f]">
            <DialogHeader>
              <DialogTitle className="text-white">Add webhook endpoint</DialogTitle>
            </DialogHeader>
            {newSecret ? (
              <div className="space-y-3">
                <p className="text-sm text-green-400">
                  Webhook created. Copy your signing secret — it won&apos;t be shown again.
                </p>
                <div className="rounded-lg border border-[#1e1e2e] bg-[#111118] p-3 font-mono text-xs text-gray-300 break-all">
                  {newSecret}
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(newSecret)
                    toast.success('Copied!')
                  }}
                >
                  Copy Secret
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Endpoint URL</label>
                  <Input
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://your-app.com/webhooks"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">Events</label>
                  <div className="space-y-2">
                    {VALID_EVENTS.map(({ value, label }) => (
                      <label key={value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEvents.includes(value)}
                          onChange={(e) =>
                            setSelectedEvents((prev) =>
                              e.target.checked ? [...prev, value] : prev.filter((v) => v !== value)
                            )
                          }
                          className="h-4 w-4 accent-purple-500"
                        />
                        <span className="text-sm text-gray-300">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={create}
                  disabled={!newUrl || selectedEvents.length === 0 || isCreating}
                >
                  {isCreating ? 'Creating...' : 'Create Endpoint'}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {webhooks.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500 text-sm">No webhook endpoints configured.</p>
          </CardContent>
        </Card>
      )}

      {webhooks.map((w) => (
        <Card key={w.id}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-mono text-gray-200 truncate">{w.url}</CardTitle>
                <CardDescription className="mt-1 flex flex-wrap gap-1">
                  {(w.events as string[]).map((e) => (
                    <Badge key={e} variant="secondary" className="text-[10px]">
                      {e}
                    </Badge>
                  ))}
                </CardDescription>
              </div>
              <button
                onClick={() => remove(w.id)}
                className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}
