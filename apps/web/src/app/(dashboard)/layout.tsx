'use client'

import { useState } from 'react'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { CommandPalette } from '@/components/layout/CommandPalette'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isOpen, open, close } = useCommandPalette()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
      {/* Sidebar (desktop always visible; mobile drawer via overlay) */}
      <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onCommandPalette={open} onMobileMenuOpen={() => setMobileSidebarOpen(true)} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>

      {/* Command palette overlay */}
      <CommandPalette isOpen={isOpen} onClose={close} />
    </div>
  )
}
