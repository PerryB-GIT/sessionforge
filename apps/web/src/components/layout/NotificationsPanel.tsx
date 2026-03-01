'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, Check, CheckCheck, AlertCircle, WifiOff } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  type: 'session_crashed' | 'machine_offline'
  title: string
  body: string
  resourceId: string | null
  readAt: string | null
  createdAt: string
}

interface NotificationsData {
  items: Notification[]
  unreadCount: number
}

export function NotificationsPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<NotificationsData>({ items: [], unreadCount: 0 })
  const [loading, setLoading] = useState(false)

  const fetchNotifications = useCallback(async () => {
    const res = await fetch('/api/notifications')
    if (!res.ok) return
    const json = await res.json()
    setData(json.data)
  }, [])

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30_000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  async function markAllRead() {
    setLoading(true)
    await fetch('/api/notifications/read-all', { method: 'POST' })
    await fetchNotifications()
    setLoading(false)
  }

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' })
    setData((prev) => ({
      ...prev,
      unreadCount: Math.max(0, prev.unreadCount - 1),
      items: prev.items.map((n) =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n
      ),
    }))
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {data.unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-[10px] font-bold text-white">
              {data.unreadCount > 9 ? '9+' : data.unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </SheetTrigger>

      <SheetContent className="w-80 border-[#1e1e2e] bg-[#0a0a0f]">
        <SheetHeader className="flex flex-row items-center justify-between">
          <SheetTitle className="text-white">Notifications</SheetTitle>
          {data.unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-gray-400 hover:text-white"
              onClick={markAllRead}
              disabled={loading}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
        </SheetHeader>

        <div className="mt-4 space-y-2 overflow-y-auto max-h-[calc(100vh-120px)] px-6">
          {data.items.length === 0 && (
            <p className="text-center text-sm text-gray-500 py-8">No notifications</p>
          )}
          {data.items.map((n) => (
            <div
              key={n.id}
              className={cn(
                'rounded-lg border p-3 cursor-pointer transition-colors',
                n.readAt
                  ? 'border-[#1e1e2e] bg-[#111118]'
                  : 'border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10'
              )}
              onClick={() => !n.readAt && markRead(n.id)}
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 shrink-0">
                  {n.type === 'session_crashed' ? (
                    <AlertCircle className="h-4 w-4 text-red-400" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-yellow-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{n.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{n.body}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
                {n.readAt && <Check className="h-3 w-3 shrink-0 text-gray-600 mt-0.5" />}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
