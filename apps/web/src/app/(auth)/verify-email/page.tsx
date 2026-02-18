'use client'

import { useState } from 'react'
import { Mail, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export default function VerifyEmailPage() {
  const [isResending, setIsResending] = useState(false)
  const [resent, setResent] = useState(false)

  async function resendEmail() {
    setIsResending(true)
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to resend email')
        return
      }
      setResent(true)
      toast.success('Verification email resent!')
    } finally {
      setIsResending(false)
    }
  }

  return (
    <div className="text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 mx-auto mb-4">
        <Mail className="h-7 w-7 text-purple-400" />
      </div>
      <h1 className="text-xl font-bold text-white mb-2">Check your email</h1>
      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        We've sent a verification link to your email address. Click the link to verify your account
        and get started.
      </p>

      <div className="rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] p-4 mb-6 text-left">
        <div className="flex items-start gap-2.5">
          <div className="h-1.5 w-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
          <p className="text-xs text-gray-400">Check your spam or junk folder if you don't see it</p>
        </div>
        <div className="flex items-start gap-2.5 mt-2">
          <div className="h-1.5 w-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
          <p className="text-xs text-gray-400">The link expires in 24 hours</p>
        </div>
      </div>

      {!resent ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={resendEmail}
          isLoading={isResending}
        >
          <RefreshCw className="h-4 w-4" />
          Resend verification email
        </Button>
      ) : (
        <p className="text-sm text-green-400">Email resent! Check your inbox.</p>
      )}

      <p className="mt-4 text-xs text-gray-600">
        Wrong email?{' '}
        <a href="/signup" className="text-purple-400 hover:text-purple-300 transition-colors">
          Sign up again
        </a>
      </p>
    </div>
  )
}
