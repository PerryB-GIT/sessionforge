'use client'

import { useState, useEffect } from 'react'
import { Shield, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

type IpAllowlistEntry = {
  id: string
  cidr: string
  label?: string | null
  createdAt: string
}

export default function SecuritySettingsPage() {
  const [entries, setEntries] = useState<IpAllowlistEntry[]>([])
  const [newCidr, setNewCidr] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [currentIp, setCurrentIp] = useState<string | null>(null)
  const [isPlanBlocked, setIsPlanBlocked] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/org/security/ip-allowlist')
      const json = await res.json()
      if (res.status === 403) {
        setIsPlanBlocked(true)
        return
      }
      if (json.data) setEntries(json.data)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load()

    // Detect current IP for convenience
    fetch('https://api.ipify.org?format=json')
      .then((r) => r.json())
      .then((d: { ip: string }) => setCurrentIp(d.ip))
      .catch(() => {})
  }, [])

  async function add() {
    if (!newCidr.trim()) return
    setIsAdding(true)
    try {
      const res = await fetch('/api/org/security/ip-allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidr: newCidr.trim(), label: newLabel.trim() || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to add entry')
        return
      }
      setEntries((prev) => [...prev, json.data])
      setNewCidr('')
      setNewLabel('')
      toast.success('IP range added')
    } catch {
      toast.error('Failed to add entry')
    } finally {
      setIsAdding(false)
    }
  }

  async function remove(id: string) {
    setRemovingId(id)
    try {
      const res = await fetch(`/api/org/security/ip-allowlist/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        toast.error(json.error?.message ?? 'Failed to remove entry')
        return
      }
      setEntries((prev) => prev.filter((e) => e.id !== id))
      toast.success('IP range removed')
    } catch {
      toast.error('Failed to remove entry')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Security</h2>
        <p className="text-sm text-gray-400">Configure IP allowlist and access restrictions</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">IP Allowlist</CardTitle>
          </div>
          <CardDescription>
            Restrict access to your organization by IP address or CIDR range. Enterprise plan
            required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPlanBlocked ? (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
              <p className="text-sm text-purple-300">
                IP allowlist is an Enterprise feature.{' '}
                <a
                  href="/settings/org#plan-billing-section"
                  className="underline hover:text-purple-200 transition-colors"
                >
                  Upgrade your plan
                </a>{' '}
                to enable it.
              </p>
            </div>
          ) : (
            <>
              {/* Current IP info */}
              {currentIp && (
                <p className="text-xs text-gray-500">
                  Your current IP:{' '}
                  <button
                    type="button"
                    className="font-mono text-purple-400 hover:text-purple-300 transition-colors"
                    onClick={() => setNewCidr(`${currentIp}/32`)}
                  >
                    {currentIp}
                  </button>{' '}
                  (click to prefill)
                </p>
              )}

              {/* Existing entries */}
              {entries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#2a2a3e] px-4 py-6 text-center">
                  <p className="text-sm text-gray-500">No restrictions — all IPs allowed</p>
                  <p className="text-xs text-gray-600 mt-1">
                    Add a CIDR range to restrict access to specific IP addresses
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between rounded-lg border border-[#1e1e2e] bg-[#0f0f14] px-3 py-2"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <code className="text-sm font-mono text-white shrink-0">{entry.cidr}</code>
                        {entry.label && (
                          <span className="text-xs text-gray-500 truncate">{entry.label}</span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        isLoading={removingId === entry.id}
                        onClick={() => remove(entry.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/10 ml-2 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new entry */}
              <div className="flex flex-col gap-2 pt-2 border-t border-[#1e1e2e]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="newCidr" className="text-xs text-gray-400">
                      CIDR Range
                    </Label>
                    <Input
                      id="newCidr"
                      placeholder="192.168.1.0/24"
                      value={newCidr}
                      onChange={(e) => setNewCidr(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') add()
                      }}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="newLabel" className="text-xs text-gray-400">
                      Label (optional)
                    </Label>
                    <Input
                      id="newLabel"
                      placeholder="Office network"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') add()
                      }}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={add}
                  isLoading={isAdding}
                  disabled={!newCidr.trim()}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Range
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
