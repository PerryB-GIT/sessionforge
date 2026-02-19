import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Documentation — SessionForge',
  description: 'SessionForge documentation and getting started guides.',
}

const sections = [
  {
    title: 'Getting Started',
    items: [
      { label: 'Quick Start', description: 'Install the agent and connect your first machine in minutes.' },
      { label: 'Installation', description: 'Detailed installation guide for Linux, macOS, and Windows.' },
      { label: 'Authentication', description: 'Set up your API key and authenticate the agent.' },
    ],
  },
  {
    title: 'Agent',
    items: [
      { label: 'Agent Overview', description: 'How the SessionForge desktop agent works.' },
      { label: 'Configuration', description: 'Configure the agent with environment variables and flags.' },
      { label: 'Systemd / LaunchAgent', description: 'Run the agent as a background service on startup.' },
    ],
  },
  {
    title: 'Dashboard',
    items: [
      { label: 'Machines', description: 'View and manage your connected machines.' },
      { label: 'Sessions', description: 'Start, stop, and interact with Claude Code sessions.' },
      { label: 'API Keys', description: 'Generate and manage API keys for automation.' },
    ],
  },
  {
    title: 'API Reference',
    items: [
      { label: 'REST API', description: 'Full REST API reference for machines, sessions, and keys.' },
      { label: 'WebSocket Protocol', description: 'Real-time agent communication protocol.' },
      { label: 'Webhooks', description: 'Receive events when sessions start, stop, or crash.' },
    ],
  },
]

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      {/* Nav */}
      <nav className="border-b border-[#1e1e2e] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            SessionForge
          </Link>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <Link href="/#features" className="hover:text-white transition-colors">Features</Link>
            <Link href="/#pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="border-b border-[#1e1e2e] px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm text-purple-400 font-medium mb-3">Documentation</p>
          <h1 className="text-4xl font-bold mb-4">SessionForge Docs</h1>
          <p className="text-gray-400 text-lg max-w-xl">
            Everything you need to install the agent, connect your machines, and manage Claude Code sessions from anywhere.
          </p>
        </div>
      </div>

      {/* Install quickstart */}
      <div className="px-6 py-12 border-b border-[#1e1e2e]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-xl font-semibold mb-6">Install the agent</h2>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-400 mb-2">Linux / macOS</p>
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg px-5 py-4 font-mono text-sm text-green-400">
                curl -sSL https://sessionforge.dev/install.sh | bash
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-2">Windows (PowerShell)</p>
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg px-5 py-4 font-mono text-sm text-blue-400">
                irm https://sessionforge.dev/install.ps1 | iex
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-2">After installation, authenticate with your API key</p>
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg px-5 py-4 font-mono text-sm text-gray-300">
                sessionforge-agent --key sf_xxxxxxxxxxxxxxxx
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sections grid */}
      <div className="px-6 py-12">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8">
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-4">
                {section.title}
              </h2>
              <div className="space-y-3">
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    className="border border-[#1e1e2e] rounded-lg p-4 hover:border-[#2a2a3e] transition-colors cursor-default"
                  >
                    <p className="font-medium text-white text-sm mb-1">{item.label}</p>
                    <p className="text-xs text-gray-500">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Full docs coming soon note */}
      <div className="px-6 pb-16">
        <div className="max-w-5xl mx-auto">
          <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-400">
              Full interactive documentation is coming soon.{' '}
              <Link href="/contact" className="text-purple-400 hover:text-purple-300 transition-colors">
                Contact us
              </Link>{' '}
              if you need help getting started.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[#1e1e2e] px-6 py-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-gray-600">
          <span>© {new Date().getFullYear()} SessionForge LLC. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-gray-400 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-400 transition-colors">Terms</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
