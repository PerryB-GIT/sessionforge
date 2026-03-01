'use client'

import { useState, useEffect } from 'react'
import { KeyRound, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SsoProvider = 'oidc' | 'saml'

type SsoConfig = {
  id: string
  provider: SsoProvider
  clientId: string | null
  issuerUrl: string | null
  samlIdpMetadataUrl: string | null
  enabled: boolean
}

export default function SsoSettingsPage() {
  const [config, setConfig] = useState<SsoConfig | null>(null)
  const [isPlanBlocked, setIsPlanBlocked] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Form state
  const [provider, setProvider] = useState<SsoProvider>('oidc')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [issuerUrl, setIssuerUrl] = useState('')
  const [samlIdpMetadataUrl, setSamlIdpMetadataUrl] = useState('')
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    fetch('/api/org/sso')
      .then((res) => {
        if (res.status === 403) {
          setIsPlanBlocked(true)
          return null
        }
        return res.json()
      })
      .then((json) => {
        if (!json) return
        // data null means no config yet or plan not eligible
        if (!json.data) {
          // If plan is fine but no config, show the form with defaults
          return
        }
        const cfg: SsoConfig = json.data
        setConfig(cfg)
        setProvider(cfg.provider)
        setClientId(cfg.clientId ?? '')
        setIssuerUrl(cfg.issuerUrl ?? '')
        setSamlIdpMetadataUrl(cfg.samlIdpMetadataUrl ?? '')
        setEnabled(cfg.enabled)
        // clientSecret is never returned — keep blank so user knows to re-enter
      })
      .catch(() => {})
  }, [])

  async function handleSave() {
    setIsSaving(true)
    try {
      const body: Record<string, unknown> = { provider, enabled }
      if (provider === 'oidc') {
        body.clientId = clientId
        body.issuerUrl = issuerUrl
        if (clientSecret) body.clientSecret = clientSecret
      } else {
        body.samlIdpMetadataUrl = samlIdpMetadataUrl
      }

      const res = await fetch('/api/org/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 403) setIsPlanBlocked(true)
        toast.error(json.error?.message ?? 'Failed to save SSO configuration')
        return
      }
      toast.success('SSO configuration saved')
      // Clear secret field after successful save — it's stored server-side
      setClientSecret('')
    } catch {
      toast.error('Failed to save SSO configuration')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Single Sign-On</h2>
        <p className="text-sm text-gray-400">Configure OIDC or SAML SSO for your organization</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-purple-400" />
            <CardTitle className="text-base">SSO Configuration</CardTitle>
          </div>
          <CardDescription>
            Allow members to authenticate via your identity provider. Enterprise plan required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isPlanBlocked ? (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
              <p className="text-sm text-purple-300">
                SSO is an Enterprise feature.{' '}
                <a
                  href="/settings/org#plan-billing-section"
                  className="underline hover:text-purple-200 transition-colors"
                >
                  Upgrade your plan
                </a>{' '}
                to enable it.
              </p>
            </div>
          ) : (
            <>
              {/* Provider selector */}
              <div className="space-y-1.5">
                <Label htmlFor="ssoProvider">Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as SsoProvider)}>
                  <SelectTrigger id="ssoProvider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oidc">OIDC (OpenID Connect)</SelectItem>
                    <SelectItem value="saml">SAML 2.0</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {provider === 'oidc' ? (
                <>
                  {/* OIDC fields */}
                  <div className="space-y-1.5">
                    <Label htmlFor="issuerUrl">Issuer URL</Label>
                    <Input
                      id="issuerUrl"
                      type="url"
                      placeholder="https://accounts.example.com"
                      value={issuerUrl}
                      onChange={(e) => setIssuerUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clientId">Client ID</Label>
                    <Input
                      id="clientId"
                      placeholder="your-client-id"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="clientSecret">
                      Client Secret{' '}
                      {config && (
                        <span className="text-gray-500 font-normal">
                          (leave blank to keep existing)
                        </span>
                      )}
                    </Label>
                    <Input
                      id="clientSecret"
                      type="password"
                      placeholder={config ? '••••••••' : 'your-client-secret'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* SAML fields */}
                  <div className="space-y-1.5">
                    <Label htmlFor="samlIdpMetadataUrl">IdP Metadata URL</Label>
                    <Input
                      id="samlIdpMetadataUrl"
                      type="url"
                      placeholder="https://idp.example.com/metadata"
                      value={samlIdpMetadataUrl}
                      onChange={(e) => setSamlIdpMetadataUrl(e.target.value)}
                    />
                    <p className="text-xs text-gray-500">
                      The URL where your identity provider exposes its SAML metadata XML.
                    </p>
                  </div>
                </>
              )}

              {/* Enabled toggle */}
              <div className="flex items-center gap-3 pt-1">
                <input
                  id="ssoEnabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[#2a2a3e] bg-[#0a0a0f] accent-purple-500 cursor-pointer"
                />
                <Label htmlFor="ssoEnabled" className="cursor-pointer select-none">
                  Enable SSO for this organization
                </Label>
              </div>

              <div className="pt-2 border-t border-[#1e1e2e]">
                <Button size="sm" isLoading={isSaving} onClick={handleSave}>
                  <Save className="h-4 w-4" />
                  Save Configuration
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
