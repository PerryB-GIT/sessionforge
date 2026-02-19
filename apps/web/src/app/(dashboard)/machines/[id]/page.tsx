'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Trash2, Monitor, Apple, Terminal, Cpu, MemoryStick, HardDrive, Clock } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MachineStatusBadge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { MachineSetupWizard } from '@/components/machines/MachineSetupWizard'
import { SessionList } from '@/components/sessions/SessionList'
import { useMachine } from '@/hooks/useMachines'
import { useSessions } from '@/hooks/useSessions'
import { useStore } from '@/store'
import { formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'

function OsIcon({ os }: { os: 'windows' | 'macos' | 'linux' }) {
  const icons = { macos: Apple, linux: Terminal, windows: Monitor }
  const Icon = icons[os]
  return <Icon className="h-5 w-5 text-purple-400" />
}

export default function MachineDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { machine, isLoading } = useMachine(id)
  const { sessions } = useSessions(id)
  const removeMachine = useStore((s) => s.removeMachine)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/machines/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to delete machine')
        return
      }
      removeMachine(id)
      toast.success('Machine deleted')
      router.push('/machines')
    } catch {
      toast.error('Failed to delete machine')
    } finally {
      setIsDeleting(false)
      setDeleteOpen(false)
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-4 animate-pulse">
        <div className="h-8 w-48 rounded bg-[#1e1e2e]" />
        <div className="h-32 rounded-xl bg-[#111118] border border-[#1e1e2e]" />
      </div>
    )
  }

  if (!machine) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-400 mb-4">Machine not found</p>
        <Link href="/machines">
          <Button variant="outline">Back to Machines</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link href="/machines">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10">
            <OsIcon os={machine.os} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{machine.name}</h2>
            <p className="text-xs text-gray-500 font-mono">{machine.hostname}</p>
          </div>
          <MachineStatusBadge status={machine.status} />
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-gray-500">CPU</span>
            </div>
            <div className="text-xl font-bold text-white">
              {machine.cpu !== undefined ? `${machine.cpu}%` : '—'}
            </div>
            {machine.cpu !== undefined && (
              <Progress
                value={machine.cpu}
                className="mt-2 h-1"
                indicatorClassName={machine.cpu > 80 ? 'bg-red-400' : 'bg-purple-500'}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <MemoryStick className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-gray-500">Memory</span>
            </div>
            <div className="text-xl font-bold text-white">
              {machine.memory !== undefined ? `${machine.memory}%` : '—'}
            </div>
            {machine.memory !== undefined && (
              <Progress
                value={machine.memory}
                className="mt-2 h-1"
                indicatorClassName={machine.memory > 80 ? 'bg-red-400' : 'bg-blue-500'}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="h-4 w-4 text-green-400" />
              <span className="text-xs text-gray-500">Disk</span>
            </div>
            <div className="text-xl font-bold text-white">
              {machine.disk !== undefined ? `${machine.disk}%` : '—'}
            </div>
            {machine.disk !== undefined && (
              <Progress
                value={machine.disk}
                className="mt-2 h-1"
                indicatorClassName={machine.disk > 80 ? 'bg-red-400' : 'bg-green-500'}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-yellow-400" />
              <span className="text-xs text-gray-500">Last Seen</span>
            </div>
            <div className="text-sm font-medium text-white">
              {formatRelativeTime(machine.lastSeen)}
            </div>
            <div className="text-xs text-gray-500 mt-0.5 capitalize">{machine.os}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={machine.status === 'offline' && sessions.length === 0 ? 'setup' : 'sessions'}>
        <TabsList>
          <TabsTrigger value="sessions">
            Sessions ({sessions.length})
          </TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <SessionList sessions={sessions} />
        </TabsContent>

        <TabsContent value="setup">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agent Setup</CardTitle>
            </CardHeader>
            <CardContent>
              <MachineSetupWizard onComplete={() => window.location.reload()} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Machine</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong className="text-white">{machine.name}</strong>?
              This will permanently remove the machine and all its session history. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} isLoading={isDeleting}>
              <Trash2 className="h-4 w-4" />
              Delete Machine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
