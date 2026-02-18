'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Mail, Lock, Eye, EyeOff, Save, Bell } from 'lucide-react'
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
