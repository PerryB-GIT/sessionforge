'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Play, Terminal } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useStore } from '@/store'
import { useMachines } from '@/hooks/useMachines'
import { toast } from 'sonner'

const schema = z.object({
  machineId: z.string().min(1, 'Please select a machine'),
  command: z.string().min(1, 'Command is required'),
  workdir: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface SessionTemplate {
  id: string
  userId: string
  orgId: string | null
  name: string
  machineId: string | null
  command: string
  workdir: string | null
  createdAt: string
  updatedAt: string
}

interface StartSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultMachineId?: string
  defaultCommand?: string
  defaultWorkdir?: string
}

export function StartSessionDialog({
  open,
  onOpenChange,
  defaultMachineId,
  defaultCommand,
  defaultWorkdir,
}: StartSessionDialogProps) {
  const machines = useStore((s) => s.machines)
  const addSession = useStore((s) => s.addSession)
  const user = useStore((s) => s.user)
  const { isLoading: machinesLoading } = useMachines()
  const onlineMachines = machines.filter((m) => m.status === 'online')
  const [isLoading, setIsLoading] = useState(false)
  const [templates, setTemplates] = useState<SessionTemplate[]>([])
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      machineId: defaultMachineId ?? '',
      command: defaultCommand ?? 'claude',
      workdir: defaultWorkdir ?? '',
    },
  })

  // Re-populate form whenever the dialog opens or Adopt pre-fill props change
  useEffect(() => {
    if (open) {
      reset({
        machineId: defaultMachineId ?? '',
        command: defaultCommand ?? 'claude',
        workdir: defaultWorkdir ?? '',
      })
      setSaveAsTemplate(false)
      setTemplateName('')
    }
  }, [open, defaultMachineId, defaultCommand, defaultWorkdir])

  // Fetch templates when dialog opens
  useEffect(() => {
    if (!open) return
    async function fetchTemplates() {
      try {
        const res = await fetch('/api/session-templates')
        if (!res.ok) return
        const json = await res.json()
        if (json.data) setTemplates(json.data)
      } catch {
        // silently ignore — templates are optional
      }
    }
    fetchTemplates()
  }, [open])

  const selectedMachineId = watch('machineId')

  function getSessionErrorMessage(code: string, fallback: string): string {
    switch (code) {
      case 'MACHINE_OFFLINE':
        return 'Your machine is offline. Make sure the SessionForge agent is running.'
      case 'SESSION_LIMIT_EXCEEDED':
      case 'PLAN_LIMIT_ERROR':
        return "You've reached your session limit. Upgrade to start more sessions."
      case 'NOT_FOUND':
        return 'Machine not found. It may have been removed.'
      default:
        return fallback
    }
  }

  async function onSubmit(data: FormData) {
    setIsLoading(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId: data.machineId,
          command: data.command,
          workdir: data.workdir || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        const code = json.error?.code ?? ''
        const fallback = json.error?.message ?? 'Failed to start session'
        toast.error(getSessionErrorMessage(code, fallback))
        return
      }
      const s = json.data
      addSession({
        id: s.id,
        machineId: s.machineId,
        userId: s.userId ?? user?.id ?? '',
        pid: s.pid ?? null,
        processName: s.processName ?? data.command.split(' ')[0],
        workdir: s.workdir ?? null,
        startedAt: s.startedAt ? new Date(s.startedAt) : new Date(),
        stoppedAt: null,
        status: 'running',
        peakMemoryMb: null,
        avgCpuPercent: null,
        claudeConversationId: null,
        adoptable: false,
      })

      if (saveAsTemplate && templateName.trim()) {
        await fetch('/api/session-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: templateName.trim(),
            machineId: data.machineId || undefined,
            command: data.command,
            workdir: data.workdir || undefined,
          }),
        })
      }

      toast.success(`Session started on ${machines.find((m) => m.id === data.machineId)?.name}`)
      reset()
      onOpenChange(false)
    } catch {
      toast.error('Connection failed. Check your internet and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10">
              <Terminal className="h-4 w-4 text-purple-400" />
            </div>
            Start New Session
          </DialogTitle>
          <DialogDescription>
            Launch a new terminal session on a connected machine.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Quick Start templates */}
          {templates.length > 0 && (
            <div className="space-y-1.5">
              <Label>Quick Start</Label>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (t.machineId) setValue('machineId', t.machineId)
                      setValue('command', t.command)
                      setValue('workdir', t.workdir ?? '')
                    }}
                    className="px-3 py-1 text-xs rounded-full border border-[#1e1e2e] bg-[#0f0f1a] text-gray-300 hover:border-purple-500/50 hover:text-purple-300 transition-colors"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Machine selector */}
          <div className="space-y-1.5">
            <Label htmlFor="machine">Machine</Label>
            {machinesLoading ? (
              <div className="rounded-lg border border-[#1e1e2e] bg-[#0f0f1a] p-3 text-xs text-gray-500">
                Loading machines...
              </div>
            ) : onlineMachines.length === 0 ? (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-yellow-400">
                No machines are currently online. Connect a machine first.
              </div>
            ) : (
              <Select value={selectedMachineId} onValueChange={(v) => setValue('machineId', v)}>
                <SelectTrigger id="machine">
                  <SelectValue placeholder="Select a machine..." />
                </SelectTrigger>
                <SelectContent>
                  {onlineMachines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                        {m.name}
                        <span className="text-gray-500 text-xs">({m.hostname})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {errors.machineId && <p className="text-xs text-red-400">{errors.machineId.message}</p>}
          </div>

          {/* Command */}
          <div className="space-y-1.5">
            <Label htmlFor="command">Command</Label>
            <Input
              id="command"
              placeholder="e.g. claude, npm run dev, python script.py"
              error={errors.command?.message}
              {...register('command')}
            />
            <p className="text-xs text-gray-500">The command to run in the new session</p>
          </div>

          {/* Working directory */}
          <div className="space-y-1.5">
            <Label htmlFor="workdir">
              Working Directory <span className="text-gray-600 font-normal">(optional)</span>
            </Label>
            <Input
              id="workdir"
              placeholder="e.g. /home/user/projects/my-app"
              className="font-mono text-xs"
              {...register('workdir')}
            />
          </div>

          <DialogFooter>
            <div className="flex items-center gap-2 mr-auto">
              <input
                type="checkbox"
                id="save-template"
                checked={saveAsTemplate}
                onChange={(e) => setSaveAsTemplate(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="save-template" className="text-xs text-gray-500 cursor-pointer">
                Save as template
              </label>
              {saveAsTemplate && (
                <input
                  type="text"
                  placeholder="Template name..."
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="text-xs px-2 py-1 rounded bg-[#0f0f1a] border border-[#1e1e2e] text-gray-300 w-32"
                />
              )}
            </div>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={isLoading}
              disabled={machinesLoading || onlineMachines.length === 0}
            >
              <Play className="h-4 w-4" />
              Start Session
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
