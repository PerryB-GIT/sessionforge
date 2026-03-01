'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, XCircle, Mail } from 'lucide-react'

export function VerifyContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const success = searchParams.get('success')

  if (success === 'true') {
    return (
      <div className="bg-[#0f0f14] border border-[#1e1e2e] rounded-xl p-8 text-center">
        <div className="flex justify-center mb-4">
          <CheckCircle className="w-12 h-12 text-green-500" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Email verified!</h1>
        <p className="text-sm text-gray-400 mb-6">
          Your email address has been verified. You can now sign in to your SessionForge account.
        </p>
        <Link
          href="/auth/login"
          className="inline-block px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Sign in
        </Link>
      </div>
    )
  }

  if (error) {
    const message =
      error === 'missing_token'
        ? 'No verification token was provided.'
        : 'This verification link is invalid or has expired.'

    return (
      <div className="bg-[#0f0f14] border border-[#1e1e2e] rounded-xl p-8 text-center">
        <div className="flex justify-center mb-4">
          <XCircle className="w-12 h-12 text-red-500" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Verification failed</h1>
        <p className="text-sm text-gray-400 mb-6">{message}</p>
        <Link
          href="/auth/register"
          className="inline-block px-6 py-2.5 bg-[#1e1e2e] hover:bg-[#2d2d3e] text-gray-200 text-sm font-semibold rounded-lg border border-[#2d2d3e] transition-colors"
        >
          Create a new account
        </Link>
      </div>
    )
  }

  // Default: just registered, check email
  return (
    <div className="bg-[#0f0f14] border border-[#1e1e2e] rounded-xl p-8 text-center">
      <div className="flex justify-center mb-4">
        <Mail className="w-12 h-12 text-purple-500" />
      </div>
      <h1 className="text-xl font-semibold text-white mb-2">Check your email</h1>
      <p className="text-sm text-gray-400 mb-2">
        We sent a verification link to your email address.
      </p>
      <p className="text-sm text-gray-500">
        Click the link in the email to activate your account. The link expires in 24 hours.
      </p>
    </div>
  )
}
