'use client'

import { useState } from 'react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useStore } from '@/store'
import { toast } from 'sonner'

const schema = z.object({
  machineId: z.string().min(1, 'Please select a machine'),
  command: z.string().min(1, 'Command is required'),
  workdir: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface StartSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultMachineId?: string
}

export function StartSessionDialog({ open, onOpenChange, defaultMachineId }: StartSessionDialogProps) {
  const machines = useStore((s) => s.machines)
  const addSession = useStore((s) => s.addSession)
  const onlineMachines = machines.filter((m) => m.status === 'online')
  const [isLoading, setIsLoading] = useState(false)

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
      command: 'claude',
      workdir: '',
    },
  })

  const selectedMachineId = watch('machineId')

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
        toast.error(json.error?.message ?? 'Failed to start session')
        return
      }
      const s = json.data
      addSession({
        id: s.id,
        machineId: s.machineId,
        pid: s.pid ?? null,
        processName: s.processName ?? data.command.split(' ')[0],
        workdir: s.workdir ?? null,
        startedAt: s.startedAt ? new Date(s.startedAt) : new Date(),
        stoppedAt: null,
        status: 'running',
        peakMemoryMb: null,
        avgCpuPercent: null,
      })
      toast.success(`Session started on ${machines.find((m) => m.id === data.machineId)?.name}`)
      reset()
      onOpenChange(false)
    } catch {
      toast.error('Failed to start session')
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
          {/* Machine selector */}
          <div className="space-y-1.5">
            <Label htmlFor="machine">Machine</Label>
            {onlineMachines.length === 0 ? (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-yellow-400">
                No machines are currently online. Connect a machine first.
              </div>
            ) : (
              <Select
                value={selectedMachineId}
                onValueChange={(v) => setValue('machineId', v)}
              >
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
            {errors.machineId && (
              <p className="text-xs text-red-400">{errors.machineId.message}</p>
            )}
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
            <p className="text-xs text-gray-500">
              The command to run in the new session
            </p>
          </div>

          {/* Working directory */}
          <div className="space-y-1.5">
            <Label htmlFor="workdir">
              Working Directory{' '}
              <span className="text-gray-600 font-normal">(optional)</span>
            </Label>
            <Input
              id="workdir"
              placeholder="e.g. /home/user/projects/my-app"
              className="font-mono text-xs"
              {...register('workdir')}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={isLoading}
              disabled={onlineMachines.length === 0}
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
