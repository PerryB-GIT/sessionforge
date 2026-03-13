'use client'

import type { Metadata } from 'next'
import Link from 'next/link'
import { useState } from 'react'
import { Check, Copy, Download, ArrowRight, Terminal, Monitor, Cpu } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

// Metadata cannot be exported from a 'use client' file — move to a separate
// layout wrapper if needed. For now we rely on the marketing layout title.

const GITHUB_BASE = 'https://github.com/PerryB-GIT/sessionforge/releases/latest/download'

const platforms = [
  {
    id: 'windows',
    label: 'Windows',
    icon: Monitor,
    command: 'iwr -useb https://sessionforge.dev/install.ps1 | iex',
    commandLang: 'PowerShell',
    downloadUrl: `${GITHUB_BASE}/sessionforge-windows-amd64.exe`,
    downloadLabel: 'sessionforge-windows-amd64.exe',
    note: 'Run in PowerShell as Administrator for best results.',
  },
  {
    id: 'macos',
    label: 'macOS',
    icon: Cpu,
    command: 'curl -fsSL https://sessionforge.dev/install.sh | bash',
    commandLang: 'Terminal',
    downloadUrl: `${GITHUB_BASE}/sessionforge-darwin-amd64`,
    downloadLabel: 'sessionforge-darwin-amd64',
    note: 'Supports Intel (amd64) and Apple Silicon (arm64) via Rosetta. Native arm64 build coming soon.',
  },
  {
    id: 'linux',
    label: 'Linux',
    icon: Terminal,
    command: 'curl -fsSL https://sessionforge.dev/install.sh | bash',
    commandLang: 'Shell',
    downloadUrl: `${GITHUB_BASE}/sessionforge-linux-amd64`,
    downloadLabel: 'sessionforge-linux-amd64',
    note: 'Works on Ubuntu, Debian, Fedora, CentOS, and most Linux distributions.',
  },
]

const afterInstallSteps = [
  {
    step: 1,
    command: 'sessionforge auth login --key YOUR_API_KEY',
    description: 'Authenticate with your API key from the dashboard.',
  },
  {
    step: 2,
    command: 'sessionforge service install',
    description: 'Register the agent as a background service (auto-starts on boot).',
  },
  {
    step: 3,
    command: 'sessionforge service start',
    description: 'Start the agent service.',
  },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded-md border border-[#27272a] bg-[#1e1e2e] px-3 py-1.5 text-xs text-gray-400 hover:border-purple-500/40 hover:text-white transition-colors shrink-0"
      aria-label="Copy command"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-green-400" />
          <span className="text-green-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

export default function InstallPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[400px] w-[700px] rounded-full bg-purple-500/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-20">
        {/* Hero */}
        <div className="mb-14 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 px-3 py-1 text-xs text-purple-300 mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            Agent v1 — available now
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight">
            Install the SessionForge Agent
          </h1>
          <p className="text-lg text-gray-400 max-w-xl mx-auto leading-relaxed">
            One command installs the agent, registers your machine, and starts the background
            service. Your machine appears in the dashboard within 30 seconds.
          </p>
        </div>

        {/* Step 1 — Install */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 text-xs font-bold text-purple-400">
              1
            </span>
            <h2 className="text-lg font-semibold text-white">Choose your platform</h2>
          </div>

          <Tabs defaultValue="windows">
            <TabsList className="mb-6">
              {platforms.map((p) => (
                <TabsTrigger key={p.id} value={p.id}>
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {platforms.map((p) => {
              const Icon = p.icon
              return (
                <TabsContent key={p.id} value={p.id}>
                  <div className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden">
                    {/* Terminal chrome */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e] bg-[#0d0d12]">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                        <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                        <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
                        <span className="ml-2 text-xs text-gray-600 font-mono">
                          {p.commandLang}
                        </span>
                      </div>
                      <CopyButton text={p.command} />
                    </div>

                    {/* Command */}
                    <div className="px-5 py-5">
                      <pre className="font-mono text-sm text-green-400 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                        {p.command}
                      </pre>
                    </div>
                  </div>

                  {/* Note */}
                  {p.note && <p className="mt-3 text-xs text-gray-500 leading-relaxed">{p.note}</p>}

                  {/* Direct download */}
                  <div className="mt-4 flex items-center gap-2">
                    <span className="text-xs text-gray-500">Or download directly:</span>
                    <a
                      href={p.downloadUrl}
                      className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {p.downloadLabel}
                    </a>
                  </div>
                </TabsContent>
              )
            })}
          </Tabs>
        </section>

        {/* Step 2 — After install */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 text-xs font-bold text-purple-400">
              2
            </span>
            <h2 className="text-lg font-semibold text-white">Connect your machine</h2>
          </div>

          <div className="space-y-3">
            {afterInstallSteps.map(({ step, command, description }) => (
              <div
                key={step}
                className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e] bg-[#0d0d12]">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-purple-500/20 bg-purple-500/10 text-xs font-semibold text-purple-400">
                      {step}
                    </span>
                    <span className="text-xs text-gray-500">{description}</span>
                  </div>
                  <CopyButton text={command} />
                </div>
                <div className="px-5 py-4">
                  <pre className="font-mono text-sm text-gray-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                    {command}
                  </pre>
                </div>
              </div>
            ))}
          </div>

          {/* Success callout */}
          <div className="mt-5 rounded-xl border border-green-500/20 bg-green-500/5 px-5 py-4 flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/15 border border-green-500/30">
              <Check className="h-3 w-3 text-green-400" />
            </span>
            <p className="text-sm text-gray-400 leading-relaxed">
              Your machine will appear in the{' '}
              <Link
                href="/dashboard"
                className="text-green-400 hover:text-green-300 transition-colors"
              >
                dashboard
              </Link>{' '}
              within 30 seconds. From there you can start sessions, monitor activity, and connect
              from any browser.
            </p>
          </div>
        </section>

        {/* API Key callout */}
        <div className="mb-12 rounded-xl border border-purple-500/20 bg-purple-500/5 px-5 py-4">
          <p className="text-sm text-gray-400 leading-relaxed">
            <span className="text-white font-medium">Need an API key?</span> Sign in to your
            dashboard and go to{' '}
            <span className="font-mono text-purple-300 text-xs">Settings → API Keys</span> to
            generate one. Keys are prefixed with{' '}
            <span className="font-mono text-purple-300 text-xs">sf_live_</span>.
          </p>
        </div>

        {/* CTA */}
        <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-8 text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Ready to get started?</h2>
          <p className="text-sm text-gray-400 mb-6">
            Create a free account to get your API key and start managing sessions.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-purple-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-purple-600 transition-colors shadow-lg shadow-purple-500/20"
            >
              Create free account
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-xl border border-[#1e1e2e] px-6 py-2.5 text-sm font-medium text-gray-300 hover:bg-[#1e1e2e] hover:text-white transition-colors"
            >
              Go to dashboard
            </Link>
          </div>
        </div>

        {/* Docs link */}
        <p className="mt-8 text-center text-sm text-gray-600">
          Looking for CLI reference or advanced config?{' '}
          <Link href="/docs" className="text-purple-400 hover:text-purple-300 transition-colors">
            View the full documentation →
          </Link>
        </p>
      </div>
    </div>
  )
}
