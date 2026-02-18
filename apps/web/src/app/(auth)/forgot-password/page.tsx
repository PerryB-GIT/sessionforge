'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

const schema = z.object({
  email: z.string().email('Invalid email address'),
})

type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const { register, handleSubmit, getValues, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      })
      if (!res.ok) {
        const json = await res.json()
        toast.error(json.error?.message ?? 'Something went wrong')
        return
      }
      setSubmitted(true)
    } finally {
      setIsLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 mx-auto mb-4">
          <Mail className="h-6 w-6 text-purple-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Check your email</h1>
        <p className="text-sm text-gray-400 mb-6">
          If an account exists for <span className="text-white">{getValues('email')}</span>, we've
          sent a password reset link.
        </p>
        <Link href="/login" className="text-sm text-purple-400 hover:text-purple-300 transition-colors">
          Return to sign in
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Reset your password</h1>
        <p className="text-sm text-gray-400 mt-1">
          Enter your email and we'll send you a reset link.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              className="pl-9"
              error={errors.email?.message}
              {...register('email')}
            />
          </div>
        </div>

        <Button type="submit" className="w-full" isLoading={isLoading}>
          Send reset link
        </Button>
      </form>

      <div className="mt-4 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
