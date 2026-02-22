'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'sf_cookie_consent'

export function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) setVisible(true)
    } catch {
      // localStorage unavailable — don't show banner
    }
  }, [])

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, 'accepted')
    } catch {}
    setVisible(false)
  }

  function decline() {
    try {
      localStorage.setItem(STORAGE_KEY, 'declined')
    } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 border-t border-[#1e1e2e] bg-[#111118] px-4 py-4',
        'md:bottom-4 md:left-4 md:right-auto md:max-w-sm md:rounded-xl md:border md:shadow-2xl'
      )}
      role="dialog"
      aria-label="Cookie consent"
    >
      <p className="mb-3 text-sm text-gray-300">
        We use cookies to keep you signed in and improve your experience.{' '}
        <Link href="/privacy" className="text-purple-400 underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={accept}>
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={decline}>
          Decline
        </Button>
      </div>
    </div>
  )
}
