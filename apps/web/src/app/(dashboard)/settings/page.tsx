'use client'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Mail, Lock, Eye, EyeOff, Save, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { SupportTicketForm } from '@/components/SupportTicketForm'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
})

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain uppercase')
      .regex(/[0-9]/, 'Must contain number'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ProfileForm = z.infer<typeof profileSchema>
type PasswordForm = z.infer<typeof passwordSchema>

export default function SettingsPage() {
  const { data: session } = useSession()
  const [showPassword, setShowPassword] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [notifPrefs, setNotifPrefs] = useState<{
    sessionCrashed: boolean
    machineOffline: boolean
    sessionStarted: boolean
    weeklyDigest: boolean
  } | null>(null)
  const [isSavingNotifs, setIsSavingNotifs] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)

  useEffect(() => {
    const DEFAULT_PREFS = {
      sessionCrashed: true,
      machineOffline: true,
      sessionStarted: false,
      weeklyDigest: true,
    }
    fetch('/api/user/notifications')
      .then((r) => r.json())
      .then((j) => setNotifPrefs(j.data ?? DEFAULT_PREFS))
      .catch(() => setNotifPrefs(DEFAULT_PREFS))
  }, [])

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      email: '',
    },
  })

  // Populate form once session data is available
  useEffect(() => {
    if (session?.user) {
      profileForm.reset({
        name: session.user.name ?? '',
        email: session.user.email ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.name, session?.user?.email])

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  })

  async function saveProfile(data: ProfileForm) {
    setIsSavingProfile(true)
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.message ?? 'Failed to save profile')
        return
      }
      toast.success('Profile updated!')
    } finally {
      setIsSavingProfile(false)
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
            {notifPrefs &&
              (
                [
                  {
                    key: 'sessionCrashed' as const,
                    label: 'Session crashed',
                    description: 'Alert when a session crashes unexpectedly',
                  },
                  {
                    key: 'machineOffline' as const,
                    label: 'Machine offline',
                    description: 'Alert when a machine goes offline',
                  },
                  {
                    key: 'sessionStarted' as const,
                    label: 'Session started',
                    description: 'Notify when a new session starts',
                  },
                  {
                    key: 'weeklyDigest' as const,
                    label: 'Weekly digest',
                    description: 'Weekly summary of session activity',
                  },
                ] as const
              ).map(({ key, label, description }) => (
                <div key={key} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{label}</p>
                    <p className="text-xs text-gray-500">{description}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifPrefs[key]}
                    onChange={(e) =>
                      setNotifPrefs((prev) => (prev ? { ...prev, [key]: e.target.checked } : prev))
                    }
                    className="h-4 w-4 rounded border-[#1e1e2e] accent-purple-500 cursor-pointer"
                  />
                </div>
              ))}
          </div>
          <Button
            size="sm"
            className="mt-4"
            isLoading={isSavingNotifs}
            disabled={!notifPrefs || isSavingNotifs}
            onClick={async () => {
              if (!notifPrefs) return
              setIsSavingNotifs(true)
              try {
                const res = await fetch('/api/user/notifications', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(notifPrefs),
                })
                if (!res.ok) {
                  const j = await res.json()
                  toast.error(j.error?.message ?? 'Failed to save preferences')
                  return
                }
                toast.success('Notification preferences saved!')
              } finally {
                setIsSavingNotifs(false)
              }
            }}
          >
            <Save className="h-4 w-4" />
            {isSavingNotifs ? 'Saving...' : 'Save Preferences'}
          </Button>
        </CardContent>
      </Card>

      {/* Support */}
      <SupportTicketForm />

      {/* Danger zone */}
      <Card className="border-red-500/20">
        <CardHeader>
          <CardTitle className="text-base text-red-400">Danger Zone</CardTitle>
          <CardDescription>Irreversible and destructive actions</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete Account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#1e1e2e] bg-[#0a0a0f]">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Delete your account?</AlertDialogTitle>
                <AlertDialogDescription className="text-gray-400">
                  This will permanently delete all your machines, sessions, API keys, and account
                  data. This action cannot be undone. Type your email address to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                placeholder={session?.user?.email ?? 'your@email.com'}
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                className="mt-2"
              />
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#1e1e2e] bg-[#111118] text-gray-300 hover:bg-[#1e1e2e]">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700 text-white"
                  disabled={deleteConfirmEmail !== session?.user?.email || isDeletingAccount}
                  onClick={async (e: { preventDefault: () => void }) => {
                    e.preventDefault()
                    setIsDeletingAccount(true)
                    try {
                      const res = await fetch('/api/user', { method: 'DELETE' })
                      if (!res.ok) {
                        const j = await res.json()
                        toast.error(j.error?.message ?? 'Failed to delete account')
                        return
                      }
                      await signOut({ callbackUrl: '/' })
                    } finally {
                      setIsDeletingAccount(false)
                    }
                  }}
                >
                  {isDeletingAccount ? 'Deleting...' : 'Delete Account'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
