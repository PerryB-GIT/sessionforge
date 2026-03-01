import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Documentation — SessionForge',
  description: 'SessionForge documentation: install the agent, CLI reference, dashboard guide, and API key management.',
}

const navItems = [
  { id: 'quick-start',        label: 'Quick Start' },
  { id: 'cli-reference',      label: 'CLI Reference' },
  { id: 'dashboard',          label: 'Dashboard' },
  { id: 'api-keys',           label: 'API Keys' },
  { id: 'platforms',          label: 'Supported Platforms' },
  { id: 'sessions',           label: 'Supported Sessions' },
]

function CodeBlock({ children, color = 'text-gray-300' }: { children: string; color?: string }) {
  return (
    <div className={`bg-[#111118] border border-[#27272a] rounded-lg px-5 py-4 font-mono text-sm overflow-x-auto whitespace-pre ${color}`}>
      {children}
    </div>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="text-xl font-semibold text-white mb-4 scroll-mt-8 flex items-center gap-2 group"
    >
      <a
        href={`#${id}`}
        className="opacity-0 group-hover:opacity-50 text-purple-400 text-base select-none"
        aria-hidden="true"
      >
        #
      </a>
      {children}
    </h2>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wider mb-2 mt-6">
      {children}
    </h3>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg px-4 py-3 text-sm text-gray-400">
      {children}
    </div>
  )
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Nav */}
      <nav className="border-b border-[#1e1e2e] px-6 py-4 sticky top-0 z-40 bg-[#0a0a0f]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            SessionForge
          </Link>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <Link href="/#features" className="hover:text-white transition-colors">Features</Link>
            <Link href="/#pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="/docs" className="text-white transition-colors">Docs</Link>
            <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto flex">
        {/* Sidebar — sticky desktop navigation */}
        <aside className="hidden lg:block w-56 shrink-0 sticky top-[57px] self-start h-[calc(100vh-57px)] overflow-y-auto border-r border-[#1e1e2e] py-10 pr-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 px-2">On this page</p>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block px-2 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-[#1e1e2e] rounded-md transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-6 lg:px-12 py-10 max-w-3xl">
          {/* Page header */}
          <div className="mb-12">
            <p className="text-sm text-purple-400 font-medium mb-2">Documentation</p>
            <h1 className="text-4xl font-bold mb-4">SessionForge Docs</h1>
            <p className="text-gray-400 text-lg">
              Install the agent, connect your machines, and manage Claude Code sessions from anywhere.
            </p>
          </div>

          {/* ────────────────────────────────────────────────────── */}
          {/* Quick Start                                           */}
          {/* ────────────────────────────────────────────────────── */}
          <section className="mb-14">
            <SectionHeading id="quick-start">Quick Start</SectionHeading>
            <p className="text-gray-400 text-sm mb-6">
              Install the SessionForge agent on any machine in under a minute. Once running, your machine appears in the dashboard and you can open remote Claude Code sessions from any browser.
            </p>

            <SubHeading>Linux / macOS — one-liner</SubHeading>
            <CodeBlock color="text-green-400">
              {`curl -fsSL https://sessionforge.dev/agent | bash -s -- --key YOUR_KEY`}
            </CodeBlock>

            <SubHeading>Windows (PowerShell) — one-liner</SubHeading>
            <CodeBlock color="text-purple-300">
              {`iwr -useb https://sessionforge.dev/agent/install.ps1 | iex; Install-SessionForge -ApiKey 'YOUR_KEY'`}
            </CodeBlock>

            <SubHeading>Manual steps</SubHeading>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1.5">1. Authenticate with your API key</p>
                <CodeBlock>{`sessionforge auth login --key sf_live_xxxxxxxxxxxx`}</CodeBlock>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">2. Install as a background service (runs on startup)</p>
                <CodeBlock>{`sessionforge service install`}</CodeBlock>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5">3. Verify the agent is running</p>
                <CodeBlock>{`sessionforge status`}</CodeBlock>
              </div>
            </div>

            <div className="mt-6">
              <Note>
                Replace <span className="font-mono text-purple-300 text-xs">YOUR_KEY</span> with an API key from{' '}
                <a href="#api-keys" className="text-purple-400 hover:text-purple-300 underline underline-offset-2">
                  Dashboard → API Keys
                </a>
                . Keys are prefixed with <span className="font-mono text-purple-300 text-xs">sf_live_</span>.
              </Note>
            </div>
          </section>

          {/* ────────────────────────────────────────────────────── */}
          {/* CLI Reference                                         */}
          {/* ────────────────────────────────────────────────────── */}
          <section className="mb-14">
            <SectionHeading id="cli-reference">Agent CLI Reference</SectionHeading>
            <p className="text-gray-400 text-sm mb-6">
              All commands are available via the <span className="font-mono text-purple-300 text-xs">sessionforge</span> binary installed by the agent setup script.
            </p>

            <div className="overflow-x-auto rounded-xl border border-[#1e1e2e]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e2e] bg-[#111118]">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider w-1/2">Command</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e1e2e]">
                  {[
                    {
                      cmd: 'sessionforge auth login --key <key> [--server URL] [--name NAME]',
                      desc: 'Authenticate this machine with an API key. Optionally set a custom server URL and display name.',
                    },
                    {
                      cmd: 'sessionforge auth logout',
                      desc: 'Remove stored credentials from this machine.',
                    },
                    {
                      cmd: 'sessionforge status',
                      desc: 'Show agent status, connected machine ID, and current sessions.',
                    },
                    {
                      cmd: 'sessionforge session list',
                      desc: 'List all sessions on this machine with their IDs and states.',
                    },
                    {
                      cmd: 'sessionforge session start [--command claude] [--workdir .]',
                      desc: 'Start a new session. Defaults to claude in the current directory.',
                    },
                    {
                      cmd: 'sessionforge session stop <SESSION_ID>',
                      desc: 'Gracefully stop a running session.',
                    },
                    {
                      cmd: 'sessionforge session attach <SESSION_ID>',
                      desc: 'Attach your terminal to an existing session (local TTY).',
                    },
                    {
                      cmd: 'sessionforge service install',
                      desc: 'Install the agent as a system service (systemd / launchd / Windows Service).',
                    },
                    {
                      cmd: 'sessionforge service uninstall',
                      desc: 'Remove the system service registration.',
                    },
                    {
                      cmd: 'sessionforge service start',
                      desc: 'Start the system service.',
                    },
                    {
                      cmd: 'sessionforge service stop',
                      desc: 'Stop the system service.',
                    },
                    {
                      cmd: 'sessionforge service restart',
                      desc: 'Restart the system service.',
                    },
                    {
                      cmd: 'sessionforge service status',
                      desc: 'Show the service health and uptime.',
                    },
                    {
                      cmd: 'sessionforge update',
                      desc: 'Download and install the latest agent binary.',
                    },
                  ].map(({ cmd, desc }) => (
                    <tr key={cmd} className="hover:bg-[#111118] transition-colors">
                      <td className="px-4 py-3 align-top">
                        <code className="font-mono text-xs text-purple-300 break-all leading-relaxed">{cmd}</code>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 align-top leading-relaxed">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ────────────────────────────────────────────────────── */}
          {/* Dashboard                                             */}
          {/* ────────────────────────────────────────────────────── */}
          <section className="mb-14">
            <SectionHeading id="dashboard">Dashboard</SectionHeading>
            <p className="text-gray-400 text-sm mb-6">
              The SessionForge web dashboard gives you a single pane of glass over all your registered machines and their sessions.
            </p>

            <div className="space-y-6">
              <div className="border border-[#1e1e2e] rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-1.5">Machines</h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Every device running the SessionForge agent appears as a Machine. The dashboard shows its online/offline status, operating system, and any active sessions. Machines stay registered even when offline and reconnect automatically when the agent restarts.
                </p>
              </div>

              <div className="border border-[#1e1e2e] rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-1.5">Sessions</h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Click any online machine to view its sessions. From there you can start a new session (choose a command and working directory), stop a running session, or open a session to interact with it. You can also start a session directly from a machine&apos;s detail page.
                </p>
              </div>

              <div className="border border-[#1e1e2e] rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-1.5">Terminal (xterm.js)</h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  The in-browser terminal is a full xterm.js instance connected to a real PTY on the remote machine via WebSocket. It supports ANSI color codes, cursor movement, resize, and keyboard input — exactly as if you had an SSH session open. No client software required.
                </p>
              </div>

              <div className="border border-[#1e1e2e] rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-1.5">API Keys</h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Generate and revoke API keys from <span className="font-mono text-purple-300">Settings → API Keys</span>. Keys authenticate the agent and can also be used to call the REST API directly for automation.
                </p>
              </div>
            </div>
          </section>

          {/* ────────────────────────────────────────────────────── */}
          {/* API Keys                                              */}
          {/* ────────────────────────────────────────────────────── */}
          <section className="mb-14">
            <SectionHeading id="api-keys">API Keys</SectionHeading>
            <p className="text-gray-400 text-sm mb-6">
              API keys authenticate the agent and authorize REST API access.
            </p>

            <div className="space-y-4">
              <div>
                <SubHeading>Creating a key</SubHeading>
                <ol className="space-y-2 text-sm text-gray-400 list-none">
                  {[
                    'Sign in to the dashboard at app.sessionforge.io.',
                    'Navigate to Settings → API Keys.',
                    'Click New Key, give it a name, and confirm.',
                    'Copy the key immediately — it is shown only once.',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 text-xs font-semibold text-purple-400">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <SubHeading>Key format</SubHeading>
                <CodeBlock color="text-purple-300">{'sf_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}</CodeBlock>
              </div>

              <Note>
                Keys are shown in full only at creation time. Store them in a secrets manager or environment variable. To rotate a key, create a new one and revoke the old one from the dashboard.
              </Note>
            </div>
          </section>

          {/* ────────────────────────────────────────────────────── */}
          {/* Supported Platforms                                   */}
          {/* ────────────────────────────────────────────────────── */}
          <section className="mb-14">
            <SectionHeading id="platforms">Supported Platforms</SectionHeading>
            <p className="text-gray-400 text-sm mb-6">
              The SessionForge agent is distributed as a single static binary with no runtime dependencies.
            </p>

            <div className="overflow-x-auto rounded-xl border border-[#1e1e2e]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e2e] bg-[#111118]">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">OS</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Architecture</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e1e2e]">
                  {[
                    { os: 'Linux',   arch: 'amd64',       note: 'Most cloud VMs and servers' },
                    { os: 'Linux',   arch: 'arm64',       note: 'AWS Graviton, Raspberry Pi 4+' },
                    { os: 'macOS',   arch: 'amd64',       note: 'Intel Macs (pre-2020)' },
                    { os: 'macOS',   arch: 'arm64',       note: 'Apple Silicon (M1, M2, M3, M4)' },
                    { os: 'Windows', arch: 'amd64 (x64)', note: 'Windows 10 / Server 2019 and later' },
                  ].map(({ os, arch, note }) => (
                    <tr key={`${os}-${arch}`} className="hover:bg-[#111118] transition-colors">
                      <td className="px-4 py-3 text-sm text-white font-medium">{os}</td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-xs text-purple-300">{arch}</code>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ────────────────────────────────────────────────────── */}
          {/* Supported Sessions                                    */}
          {/* ────────────────────────────────────────────────────── */}
          <section className="mb-14">
            <SectionHeading id="sessions">Supported Sessions</SectionHeading>
            <p className="text-gray-400 text-sm mb-6">
              Any of the following commands can be passed to <span className="font-mono text-purple-300 text-xs">--command</span> when starting a session. The agent spawns the process in a PTY.
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { name: 'claude',      desc: 'Claude Code (default)' },
                { name: 'bash',        desc: 'Bash shell' },
                { name: 'zsh',         desc: 'Zsh shell' },
                { name: 'sh',          desc: 'POSIX shell' },
                { name: 'powershell',  desc: 'PowerShell (Windows/cross-platform)' },
                { name: 'cmd',         desc: 'Windows Command Prompt' },
              ].map(({ name, desc }) => (
                <div
                  key={name}
                  className="flex items-center gap-3 border border-[#1e1e2e] rounded-lg px-4 py-3 hover:border-[#2a2a3e] transition-colors"
                >
                  <code className="font-mono text-sm text-purple-300 min-w-[100px]">{name}</code>
                  <span className="text-xs text-gray-400">{desc}</span>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <Note>
                The target command must be installed on the remote machine. The agent does not bundle interpreters or runtimes.
              </Note>
            </div>
          </section>

          {/* Help callout */}
          <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-400 mb-1">Need help?</p>
            <p className="text-sm text-gray-400">
              <Link href="/contact" className="text-purple-400 hover:text-purple-300 transition-colors">
                Contact us
              </Link>{' '}
              or{' '}
              <a
                href="mailto:support@sessionforge.dev"
                className="text-purple-400 hover:text-purple-300 transition-colors"
              >
                email support@sessionforge.dev
              </a>
              .
            </p>
          </div>
        </main>
      </div>

      {/* Footer */}
      <div className="border-t border-[#1e1e2e] px-6 py-8 mt-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-gray-600">
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
