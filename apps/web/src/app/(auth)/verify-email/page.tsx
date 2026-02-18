'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Mail, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signIn } from 'next-auth/react'
import { toast } from 'sonner'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const isMagic = searchParams.get('magic') === '1'
  const email = searchParams.get('email') ?? ''

  const [isResending, setIsResending] = useState(false)
  const [resent, setResent] = useState(false)

  async function resend() {
    setIsResending(true)
    try {
      if (isMagic && email) {
        // Resend magic link
        await signIn('resend', { email, redirect: false, callbackUrl: '/dashboard' })
        setResent(true)
        toast.success('Magic link resent!')
      } else {
        // Resend verification email for credentials signup
        const res = await fetch('/api/auth/resend-verification', { method: 'POST' })
        const json = await res.json()
        if (!res.ok) {
          toast.error(json.error?.message ?? 'Failed to resend email')
          return
        }
        setResent(true)
        toast.success('Verification email resent!')
      }
    } catch {
      toast.error('Failed to resend. Please try again.')
    } finally {
      setIsResending(false)
    }
  }

  return (
    <div className="text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 mx-auto mb-4">
        <Mail className="h-7 w-7 text-purple-400" />
      </div>

      <h1 className="text-xl font-bold text-white mb-2">
        {isMagic ? 'Magic link sent!' : 'Check your email'}
      </h1>

      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        {isMagic
          ? `We sent a sign-in link to ${email ? <strong>{email}</strong> : 'your email'}. Click it to log in — no password needed.`
          : "We've sent a verification link to your email address. Click it to verify your account and get started."
        }
      </p>

      <div className="rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] p-4 mb-6 text-left space-y-2">
        <div className="flex items-start gap-2.5">
          <div className="h-1.5 w-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
          <p className="text-xs text-gray-400">Check your spam or junk folder if you don't see it</p>
        </div>
        <div className="flex items-start gap-2.5">
          <div className="h-1.5 w-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
          <p className="text-xs text-gray-400">The link expires in {isMagic ? '10 minutes' : '24 hours'}</p>
        </div>
        {isMagic && (
          <div className="flex items-start gap-2.5">
            <div className="h-1.5 w-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
            <p className="text-xs text-gray-400">Clicking the link will sign you in automatically</p>
          </div>
        )}
      </div>

      {!resent ? (
        <Button variant="outline" className="w-full" onClick={resend} isLoading={isResending}>
          <RefreshCw className="h-4 w-4" />
          {isMagic ? 'Resend magic link' : 'Resend verification email'}
        </Button>
      ) : (
        <p className="text-sm text-green-400">Sent! Check your inbox.</p>
      )}

      <p className="mt-4 text-xs text-gray-600">
        Wrong email?{' '}
        <a href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">
          Go back to login
        </a>
      </p>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  )
}
