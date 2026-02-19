import Link from 'next/link'
import { Zap } from 'lucide-react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[400px] w-[600px] rounded-full bg-purple-500/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-[300px] w-[400px] rounded-full bg-purple-700/3 blur-3xl" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(139, 92, 246, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.5) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Logo */}
      <div className="relative mb-8">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500 shadow-lg shadow-purple-500/30">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-white">SessionForge</span>
        </Link>
      </div>

      {/* Card */}
      <div className="relative w-full max-w-sm px-4">
        <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] shadow-2xl shadow-black/50 p-8">
          {children}
        </div>
      </div>

      {/* Footer */}
      <div className="relative mt-8 text-center">
        <p className="text-xs text-gray-600">
          By continuing, you agree to our{' '}
          <a href="/terms" className="text-gray-500 hover:text-white transition-colors">
            Terms
          </a>{' '}
          and{' '}
          <a href="/privacy" className="text-gray-500 hover:text-white transition-colors">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  )
}
