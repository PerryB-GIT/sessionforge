import { Suspense } from 'react'
import Link from 'next/link'
import { VerifyContent } from './verify-content'

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-2xl font-bold text-white tracking-tight">
              Session<span className="text-purple-500">Forge</span>
            </span>
          </Link>
        </div>
        <Suspense fallback={<VerifyFallback />}>
          <VerifyContent />
        </Suspense>
      </div>
    </div>
  )
}

function VerifyFallback() {
  return (
    <div className="bg-[#0f0f14] border border-[#1e1e2e] rounded-xl p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-[#1e1e2e] mx-auto mb-4 animate-pulse" />
      <div className="h-4 bg-[#1e1e2e] rounded mx-auto w-48 mb-2 animate-pulse" />
      <div className="h-3 bg-[#1e1e2e] rounded mx-auto w-64 animate-pulse" />
    </div>
  )
}
