import Link from 'next/link'
import { Zap } from 'lucide-react'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Nav */}
      <nav className="border-b border-[#1e1e2e] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">SessionForge</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/login" className="text-sm text-gray-400 hover:text-white transition-colors">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-purple-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-600 transition-colors"
              >
                Get started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      {children}

      {/* Footer */}
      <footer className="border-t border-[#1e1e2e] py-10 mt-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-purple-500">
                <Zap className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-medium text-white">SessionForge</span>
            </div>
            <div className="flex gap-6">
              <Link href="/privacy" className="text-sm text-gray-500 hover:text-white transition-colors">
                Privacy
              </Link>
              <Link href="/terms" className="text-sm text-gray-500 hover:text-white transition-colors">
                Terms
              </Link>
              <Link href="/aup" className="text-sm text-gray-500 hover:text-white transition-colors">
                Acceptable Use
              </Link>
              <Link href="/docs" className="text-sm text-gray-500 hover:text-white transition-colors">
                Docs
              </Link>
            </div>
            <p className="text-xs text-gray-600">&copy; 2026 SessionForge. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
