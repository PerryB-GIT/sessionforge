'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Mail, Lock, Eye, EyeOff, Save, Bell, Bug, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type ProfileForm = z.infer<typeof profileSchema>
type PasswordForm = z.infer<typeof passwordSchema>

export default function SettingsPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [isLoadingProfile, setIsLoadingProfile] = useState(true)
  const [hasPassword, setHasPassword] = useState(true)

  // Support & Debug state
  const [debugMode, setDebugMode] = useState(false)
  const [supportSubject, setSupportSubject] = useState('')
  const [supportMessage, setSupportMessage] = useState('')
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false)

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: '', email: '' },
  })

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  })

  // Load real user data on mount
  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/user')
        if (!res.ok) throw new Error('Failed to load profile')
        const json = await res.json()
        if (json.data) {
          profileForm.reset({
            name: json.data.name ?? '',
            email: json.data.email ?? '',
          })
          // OAuth users (no image from password flow) may have no password
          // We'll detect this when they try to change password
        }
      } catch {
        toast.error('Failed to load profile')
      } finally {
        setIsLoadingProfile(false)
      }
    }
    fetchUser()
  }, [profileForm])

  async function saveProfile(data: ProfileForm) {
    setIsSavingProfile(true)
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, email: data.email }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to update profile')
        return
      }
      toast.success('Profile updated!')
    } finally {
      setIsSavingProfile(false)
    }
  }

  // Initialise debug mode from localStorage + intercept console.error
  useEffect(() => {
    const stored = localStorage.getItem('sf_debug_mode') === 'true'
    setDebugMode(stored)
    if (stored) startDebugCapture()
    return () => stopDebugCapture()
  }, [])

  function startDebugCapture() {
    if (typeof window === 'undefined') return
    if (!(window as any).__sfDebugOrig) {
      ;(window as any).__sfDebugLogs = []
      ;(window as any).__sfDebugOrig = console.error
      console.error = (...args: unknown[]) => {
        ;(window as any).__sfDebugLogs.push(new Date().toISOString() + ' ' + args.map(String).join(' '))
        ;(window as any).__sfDebugOrig(...args)
      }
    }
  }

  function stopDebugCapture() {
    if (typeof window === 'undefined') return
    if ((window as any).__sfDebugOrig) {
      console.error = (window as any).__sfDebugOrig
      delete (window as any).__sfDebugOrig
    }
  }

  function toggleDebugMode(enabled: boolean) {
    setDebugMode(enabled)
    localStorage.setItem('sf_debug_mode', String(enabled))
    if (enabled) {
      startDebugCapture()
      toast.success('Debug logging enabled — errors will be captured')
    } else {
      stopDebugCapture()
      ;(window as any).__sfDebugLogs = []
      toast.success('Debug logging disabled')
    }
  }

  async function submitSupportRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!supportSubject.trim() || !supportMessage.trim()) {
      toast.error('Please fill in subject and message')
      return
    }
    setIsSubmittingSupport(true)
    try {
      const browserLogs = debugMode
        ? ((window as any).__sfDebugLogs ?? []).join('\n')
        : undefined

      // Fetch latest agent logs if debug mode is on
      let agentLogs: string | undefined
      if (debugMode) {
        try {
          const logsRes = await fetch('/api/sessions?limit=1')
          if (logsRes.ok) {
            const logsJson = await logsRes.json()
            const latestSessionId = logsJson.data?.[0]?.id
            if (latestSessionId) {
              const sessionLogsRes = await fetch(`/api/sessions/${latestSessionId}/logs`)
              if (sessionLogsRes.ok) {
                const sessionLogsJson = await sessionLogsRes.json()
                agentLogs = Array.isArray(sessionLogsJson.logs)
                  ? sessionLogsJson.logs.join('\n')
                  : String(sessionLogsJson.logs ?? '')
              }
            }
          }
        } catch {
          // Non-fatal — proceed without agent logs
        }
      }

      const res = await fetch('/api/support/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: supportSubject.trim(),
          message: supportMessage.trim(),
          browserLogs: browserLogs || undefined,
          agentLogs,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Failed to submit support request')
        return
      }
      toast.success('Support request submitted! We\'ll get back to you soon.')
      setSupportSubject('')
      setSupportMessage('')
    } catch {
      toast.error('Failed to submit. Please try again.')
    } finally {
      setIsSubmittingSupport(false)
    }
  }

  async function changePassword(data: PasswordForm) {
    setIsChangingPassword(true)
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error?.message?.includes('social login')) {
          setHasPassword(false)
        }
        toast.error(json.error?.message ?? 'Failed to change password')
        return
      }
      toast.success('Password changed!')
      passwordForm.reset()
    } finally {
      setIsChangingPassword(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Settings</h2>
        <p className="text-sm text-gray-400">Manage your account and preferences</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">Profile</CardTitle>
          </div>
          <CardDescription>Update your name and email address</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingProfile ? (
            <div className="flex items-center gap-2 py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
              <span className="text-sm text-gray-500">Loading profile…</span>
            </div>
          ) : (
            <form onSubmit={profileForm.handleSubmit(saveProfile)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  error={profileForm.formState.errors.name?.message}
                  {...profileForm.register('name')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <Input
                    id="email"
                    type="email"
                    className="pl-9"
                    error={profileForm.formState.errors.email?.message}
                    {...profileForm.register('email')}
                  />
                </div>
              </div>
              <Button type="submit" size="sm" isLoading={isSavingProfile}>
                <Save className="h-4 w-4" />
                Save Changes
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">Password</CardTitle>
          </div>
          <CardDescription>Change your account password</CardDescription>
        </CardHeader>
        <CardContent>
          {!hasPassword ? (
            <p className="text-sm text-gray-400">
              Your account uses social login (Google or GitHub). Password changes are not available.
            </p>
          ) : (
            <form onSubmit={passwordForm.handleSubmit(changePassword)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="currentPassword">Current Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <Input
                    id="currentPassword"
                    type={showPassword ? 'text' : 'password'}
                    className="pl-9 pr-9"
                    error={passwordForm.formState.errors.currentPassword?.message}
                    {...passwordForm.register('currentPassword')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  error={passwordForm.formState.errors.newPassword?.message}
                  {...passwordForm.register('newPassword')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  error={passwordForm.formState.errors.confirmPassword?.message}
                  {...passwordForm.register('confirmPassword')}
                />
              </div>
              <Button type="submit" size="sm" isLoading={isChangingPassword}>
                Update Password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">Notifications</CardTitle>
          </div>
          <CardDescription>Configure when you receive alerts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { label: 'Session crashed', description: 'Alert when a session crashes unexpectedly', defaultChecked: true },
              { label: 'Machine offline', description: 'Alert when a machine goes offline', defaultChecked: true },
              { label: 'Session started', description: 'Notify when a new session starts', defaultChecked: false },
              { label: 'Weekly digest', description: 'Weekly summary of session activity', defaultChecked: true },
            ].map(({ label, description, defaultChecked }) => (
              <div key={label} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-gray-500">{description}</p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked={defaultChecked}
                  className="h-4 w-4 rounded border-[#1e1e2e] accent-purple-500 cursor-pointer"
                />
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-4">
            <Save className="h-4 w-4" />
            Save Preferences
          </Button>
        </CardContent>
      </Card>

      {/* Support & Debug */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">Support &amp; Debug</CardTitle>
          </div>
          <CardDescription>Enable debug logging and contact our team for help</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Debug toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Debug Logging</p>
              <p className="text-xs text-gray-500">Captures browser errors and agent logs with support requests</p>
            </div>
            <button
              type="button"
              onClick={() => toggleDebugMode(!debugMode)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                debugMode ? 'bg-purple-600' : 'bg-[#1e1e2e]'
              }`}
              role="switch"
              aria-checked={debugMode}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  debugMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {debugMode && (
            <p className="text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
              Debug mode active — browser errors and agent logs will be attached to your next support request.
            </p>
          )}

          {/* Support form */}
          <form onSubmit={submitSupportRequest} className="space-y-3 pt-1 border-t border-[#1e1e2e]">
            <div className="space-y-1.5">
              <Label htmlFor="support-subject">Subject</Label>
              <Input
                id="support-subject"
                placeholder="e.g. Agent not connecting, session stuck..."
                value={supportSubject}
                onChange={(e) => setSupportSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="support-message">Describe your issue</Label>
              <textarea
                id="support-message"
                rows={4}
                placeholder="What were you trying to do? What happened instead? Any error messages?"
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
                className="w-full rounded-md border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
              />
            </div>
            <Button type="submit" size="sm" isLoading={isSubmittingSupport}>
              <Send className="h-4 w-4" />
              Submit Support Request
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-red-500/20">
        <CardHeader>
          <CardTitle className="text-base text-red-400">Danger Zone</CardTitle>
          <CardDescription>Irreversible and destructive actions</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive">Delete Account</Button>
        </CardContent>
      </Card>
    </div>
  )
}
