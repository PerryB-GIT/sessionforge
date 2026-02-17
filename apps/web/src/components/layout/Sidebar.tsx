'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  Monitor,
  Terminal,
  Key,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Activity,
  CreditCard,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/machines', label: 'Machines', icon: Monitor },
  { href: '/sessions', label: 'Sessions', icon: Terminal },
  { href: '/keys', label: 'API Keys', icon: Key },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const wsStatus = useStore((s) => s.wsStatus)

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-[#1e1e2e] bg-[#0a0a0f] transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-[#1e1e2e] px-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500 shadow-lg shadow-purple-500/30">
            <Zap className="h-4 w-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold text-white whitespace-nowrap">
              SessionForge
            </span>
          )}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <ul className="space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors group',
                    active
                      ? 'bg-purple-500/10 text-purple-400'
                      : 'text-gray-400 hover:bg-[#1e1e2e] hover:text-white'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      active ? 'text-purple-400' : 'text-gray-500 group-hover:text-white'
                    )}
                  />
                  {!collapsed && <span className="whitespace-nowrap">{label}</span>}
                  {!collapsed && active && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-purple-400" />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>

        {/* Divider */}
        {!collapsed && (
          <div className="my-4 border-t border-[#1e1e2e]" />
        )}

        {/* Bottom items */}
        {!collapsed && (
          <ul className="space-y-0.5">
            <li>
              <Link
                href="/settings/org"
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-[#1e1e2e] hover:text-white transition-colors"
              >
                <CreditCard className="h-4 w-4 shrink-0 text-gray-500" />
                <span>Billing</span>
              </Link>
            </li>
          </ul>
        )}
      </nav>

      {/* WS Status + Collapse */}
      <div className="border-t border-[#1e1e2e] p-3">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2 px-1">
            <Activity className="h-3 w-3 text-gray-500" />
            <span className="text-xs text-gray-500">Live status:</span>
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  wsStatus === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-gray-500'
                )}
              />
              <span
                className={cn(
                  'text-xs capitalize',
                  wsStatus === 'connected' ? 'text-green-400' : 'text-gray-500'
                )}
              >
                {wsStatus}
              </span>
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-center justify-center rounded-lg p-1.5 text-gray-500 hover:bg-[#1e1e2e] hover:text-white transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  )
}
