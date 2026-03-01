'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Monitor, Terminal, Key, Settings, LayoutDashboard, X } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ElementType
  action: () => void
  category: string
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()
  const machines = useStore((s) => s.machines)
  const sessions = useStore((s) => s.sessions)

  const navItems: CommandItem[] = [
    {
      id: 'nav-dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      action: () => { router.push('/dashboard'); onClose() },
      category: 'Navigation',
    },
    {
      id: 'nav-machines',
      label: 'Machines',
      icon: Monitor,
      action: () => { router.push('/machines'); onClose() },
      category: 'Navigation',
    },
    {
      id: 'nav-sessions',
      label: 'Sessions',
      icon: Terminal,
      action: () => { router.push('/sessions'); onClose() },
      category: 'Navigation',
    },
    {
      id: 'nav-keys',
      label: 'API Keys',
      icon: Key,
      action: () => { router.push('/keys'); onClose() },
      category: 'Navigation',
    },
    {
      id: 'nav-settings',
      label: 'Settings',
      icon: Settings,
      action: () => { router.push('/settings'); onClose() },
      category: 'Navigation',
    },
  ]

  const machineItems: CommandItem[] = machines.map((m) => ({
    id: `machine-${m.id}`,
    label: m.name,
    description: m.hostname,
    icon: Monitor,
    action: () => { router.push(`/machines/${m.id}`); onClose() },
    category: 'Machines',
  }))

  const sessionItems: CommandItem[] = sessions
    .filter((s) => s.status === 'running')
    .map((s) => ({
      id: `session-${s.id}`,
      label: s.processName,
      description: s.workdir ?? undefined,
      icon: Terminal,
      action: () => { router.push(`/sessions/${s.id}`); onClose() },
      category: 'Active Sessions',
    }))

  const allItems = [...navItems, ...machineItems, ...sessionItems]

  const filtered = query
    ? allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.description?.toLowerCase().includes(query.toLowerCase())
      )
    : allItems

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        filtered[selectedIndex].action()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filtered, selectedIndex])

  if (!isOpen) return null

  // Group by category
  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-[#1e1e2e] bg-[#111118] shadow-2xl shadow-black/50">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[#1e1e2e] px-4">
          <Search className="h-4 w-4 text-gray-500 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search machines, sessions, navigate..."
            className="flex-1 bg-transparent py-3.5 text-sm text-white placeholder:text-gray-500 focus:outline-none"
          />
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No results found.</p>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="mb-1">
                <p className="mb-1 px-2 pt-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                  {category}
                </p>
                {items.map((item) => {
                  const Icon = item.icon
                  const globalIndex = filtered.indexOf(item)
                  return (
                    <button
                      key={item.id}
                      onClick={item.action}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                        globalIndex === selectedIndex
                          ? 'bg-purple-500/10 text-white'
                          : 'text-gray-300 hover:bg-[#1e1e2e] hover:text-white'
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-lg',
                          globalIndex === selectedIndex ? 'bg-purple-500/20' : 'bg-[#1e1e2e]'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="font-medium">{item.label}</div>
                        {item.description && (
                          <div className="text-xs text-gray-500">{item.description}</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[#1e1e2e] px-4 py-2 flex items-center gap-4">
          <span className="text-xs text-gray-600">
            <kbd className="rounded border border-[#2a2a3e] px-1 text-[10px]">↑↓</kbd> navigate
          </span>
          <span className="text-xs text-gray-600">
            <kbd className="rounded border border-[#2a2a3e] px-1 text-[10px]">↵</kbd> select
          </span>
          <span className="text-xs text-gray-600">
            <kbd className="rounded border border-[#2a2a3e] px-1 text-[10px]">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
