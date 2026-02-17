'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, Lock, Eye, EyeOff, Github, Chrome } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isMagicLoading, setIsMagicLoading] = useState(false)
  const router = useRouter()

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setIsLoading(true)
    try {
      // STUB: Replace with tRPC or NextAuth signIn('credentials', ...)
      await new Promise((r) => setTimeout(r, 1000))
      toast.success('Signed in successfully!')
      router.push('/dashboard')
    } catch {
      toast.error('Invalid email or password')
    } finally {
      setIsLoading(false)
    }
  }

  async function sendMagicLink() {
    const email = getValues('email')
    if (!email) {
      toast.error('Enter your email address first')
      return
    }
    setIsMagicLoading(true)
    try {
      // STUB: POST /api/auth/magic-link { email }
      await new Promise((r) => setTimeout(r, 800))
      toast.success(`Magic link sent to ${email}`)
      router.push('/verify-email')
    } finally {
      setIsMagicLoading(false)
    }
  }

  function handleOAuth(provider: 'google' | 'github') {
    // STUB: NextAuth signIn(provider)
    toast.info(`Redirecting to ${provider}...`)
    window.location.href = `/api/auth/${provider}`
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Welcome back</h1>
        <p className="text-sm text-gray-400 mt-1">Sign in to your SessionForge account</p>
      </div>

      {/* OAuth buttons */}
      <div className="space-y-2 mb-6">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => handleOAuth('google')}
        >
          <Chrome className="h-4 w-4 text-blue-400" />
          Continue with Google
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => handleOAuth('github')}
        >
          <Github className="h-4 w-4" />
          Continue with GitHub
        </Button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 mb-6">
        <div className="h-px flex-1 bg-[#1e1e2e]" />
        <span className="text-xs text-gray-600">or continue with email</span>
        <div className="h-px flex-1 bg-[#1e1e2e]" />
      </div>

      {/* Email/password form */}
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

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              className="pl-9 pr-9"
              error={errors.password?.message}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" className="w-full" isLoading={isLoading}>
          Sign in
        </Button>
      </form>

      {/* Magic link */}
      <div className="mt-4">
        <button
          type="button"
          onClick={sendMagicLink}
          disabled={isMagicLoading}
          className="flex w-full items-center justify-center gap-2 text-xs text-gray-400 hover:text-white transition-colors py-2"
        >
          <Mail className="h-3.5 w-3.5" />
          {isMagicLoading ? 'Sending...' : 'Send me a magic link instead'}
        </button>
      </div>

      {/* Sign up link */}
      <p className="mt-6 text-center text-sm text-gray-500">
        Don't have an account?{' '}
        <Link href="/signup" className="text-purple-400 hover:text-purple-300 transition-colors">
          Sign up free
        </Link>
      </p>
    </div>
  )
}
