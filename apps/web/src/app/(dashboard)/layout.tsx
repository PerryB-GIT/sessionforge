'use client'

import { useCommandPalette } from '@/hooks/useCommandPalette'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { CommandPalette } from '@/components/layout/CommandPalette'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isOpen, open, close } = useCommandPalette()

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onCommandPalette={open} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>

      {/* Command palette overlay */}
      <CommandPalette isOpen={isOpen} onClose={close} />
    </div>
  )
}
