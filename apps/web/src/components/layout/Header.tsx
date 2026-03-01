'use client'

import { usePathname } from 'next/navigation'
import { Bell, Search, User, LogOut, Settings, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const routeTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/machines': 'Machines',
  '/sessions': 'Sessions',
  '/keys': 'API Keys',
  '/settings': 'Settings',
  '/settings/org': 'Organization Settings',
  '/onboarding': 'Get Started',
}

function getBreadcrumb(pathname: string): { title: string; segments: string[] } {
  const title = routeTitles[pathname] ?? 'SessionForge'
  const segments = pathname.split('/').filter(Boolean)
  return { title, segments }
}

export function Header({ onCommandPalette }: { onCommandPalette?: () => void }) {
  const pathname = usePathname()
  const { title } = getBreadcrumb(pathname)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { data: session } = useSession()
  const userName = session?.user?.name ?? session?.user?.email?.split('@')[0] ?? 'Account'
  const userEmail = session?.user?.email ?? ''

  return (
    <header className="flex h-14 items-center justify-between border-b border-[#1e1e2e] bg-[#0a0a0f] px-4 lg:px-6">
      {/* Page title */}
      <h1 className="text-sm font-semibold text-white">{title}</h1>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Search / Command Palette trigger */}
        <button
          onClick={onCommandPalette}
          className="hidden sm:flex items-center gap-2 rounded-lg border border-[#1e1e2e] bg-[#111118] px-3 py-1.5 text-xs text-gray-500 hover:border-purple-500/50 hover:text-gray-300 transition-colors"
        >
          <Search className="h-3 w-3" />
          <span>Search...</span>
          <kbd className="ml-2 inline-flex items-center gap-1 rounded border border-[#2a2a3e] px-1.5 py-0.5 text-[10px] text-gray-600">
            <span>⌘</span>K
          </kbd>
        </button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-purple-500" />
          <span className="sr-only">Notifications</span>
        </Button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-[#1e1e2e] transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-500/20 border border-purple-500/30">
              <User className="h-4 w-4 text-purple-400" />
            </div>
            <span className="hidden text-sm text-gray-300 sm:block">{userName}</span>
            <ChevronDown className="h-3 w-3 text-gray-500" />
          </button>

          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setUserMenuOpen(false)}
              />
              <div className="absolute right-0 top-10 z-20 w-48 rounded-xl border border-[#1e1e2e] bg-[#111118] py-1 shadow-2xl shadow-black/50">
                <div className="border-b border-[#1e1e2e] px-3 py-2">
                  <p className="text-sm font-medium text-white">{userName}</p>
                  <p className="text-xs text-gray-500">{userEmail}</p>
                </div>
                <a
                  href="/settings"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:bg-[#1e1e2e] hover:text-white transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </a>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  onClick={() => signOut({ callbackUrl: '/login' })}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
