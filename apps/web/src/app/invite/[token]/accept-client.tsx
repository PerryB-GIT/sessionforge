'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Props {
  token: string
  orgName: string
  email: string
  expired: boolean
  accepted: boolean
}

export default function InviteAcceptClient({ token, orgName, email, expired, accepted }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  if (accepted) {
    return (
      <InviteShell>
        <p className="text-xl font-semibold text-white mb-2">Already accepted</p>
        <p className="text-sm text-gray-400 mb-6">You&apos;re already a member of <strong className="text-white">{orgName}</strong>.</p>
        <a href="/dashboard" className="inline-block px-5 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-500 transition-colors">
          Go to Dashboard
        </a>
      </InviteShell>
    )
  }

  if (expired) {
    return (
      <InviteShell>
        <p className="text-xl font-semibold text-white mb-2">Invitation expired</p>
        <p className="text-sm text-gray-400">This invitation has expired. Ask your admin to send a new one.</p>
      </InviteShell>
    )
  }

  async function handleAccept() {
    setLoading(true)
    try {
      const res = await fetch(`/api/org/invites/${token}/accept`, { method: 'POST' })
      const json = await res.json()

      if (res.status === 401) {
        // Not logged in — redirect to signup with invite param
        router.push(`/signup?invite=${token}`)
        return
      }

      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to accept invitation')
        return
      }

      toast.success(`You've joined ${orgName}!`)
      router.push('/dashboard')
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <InviteShell>
      <p className="text-xl font-semibold text-white mb-2">You&apos;ve been invited</p>
      <p className="text-sm text-gray-400 mb-6">
        Join <strong className="text-white">{orgName}</strong> on SessionForge.
        This invite was sent to <span className="text-gray-300">{email}</span>.
      </p>
      <button
        onClick={handleAccept}
        disabled={loading}
        className="px-6 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-500 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Joining...' : `Join ${orgName}`}
      </button>
    </InviteShell>
  )
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#1e1e2e] bg-[#0f0f14] p-8 text-center">
        <span className="block text-2xl font-bold text-white mb-6">
          Session<span className="text-purple-400">Forge</span>
        </span>
        {children}
      </div>
    </div>
  )
}
