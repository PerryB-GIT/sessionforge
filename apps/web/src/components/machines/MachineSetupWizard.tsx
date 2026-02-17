'use client'

import { useState } from 'react'
import { Check, Copy, Terminal, Monitor, CheckCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface MachineSetupWizardProps {
  apiKey?: string
  onComplete?: () => void
}

const INSTALL_COMMANDS = {
  linux: `curl -fsSL https://get.sessionforge.io/agent | bash -s -- --key SF_API_KEY`,
  macos: `curl -fsSL https://get.sessionforge.io/agent | bash -s -- --key SF_API_KEY`,
  windows: `iwr -useb https://get.sessionforge.io/agent/install.ps1 | iex; Install-SessionForge -ApiKey 'SF_API_KEY'`,
}

type TabType = 'linux' | 'macos' | 'windows'

export function MachineSetupWizard({ apiKey = 'sf_live_xxxxxxxxxxxxxxxxxxxx', onComplete }: MachineSetupWizardProps) {
  const [step, setStep] = useState(1)
  const [tab, setTab] = useState<TabType>('linux')
  const [copied, setCopied] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verified, setVerified] = useState(false)

  const command = INSTALL_COMMANDS[tab].replace('SF_API_KEY', apiKey)

  async function copyCommand() {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    toast.success('Command copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  async function verifyConnection() {
    setIsVerifying(true)
    // STUB: Poll /api/machines for new machine
    await new Promise((resolve) => setTimeout(resolve, 3000))
    setIsVerifying(false)
    setVerified(true)
    toast.success('Machine connected successfully!')
    setTimeout(() => {
      setStep(3)
      onComplete?.()
    }, 1000)
  }

  const tabs: { label: string; value: TabType }[] = [
    { label: 'Linux', value: 'linux' },
    { label: 'macOS', value: 'macos' },
    { label: 'Windows', value: 'windows' },
  ]

  return (
    <div className="max-w-2xl">
      {/* Steps indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                step > s
                  ? 'bg-green-500 text-white'
                  : step === s
                  ? 'bg-purple-500 text-white'
                  : 'bg-[#1e1e2e] text-gray-500'
              }`}
            >
              {step > s ? <Check className="h-3 w-3" /> : s}
            </div>
            {s < 3 && <div className={`h-px w-8 ${step > s ? 'bg-green-500' : 'bg-[#1e1e2e]'}`} />}
          </div>
        ))}
        <span className="ml-2 text-xs text-gray-500">
          {step === 1 && 'Install the agent'}
          {step === 2 && 'Verify connection'}
          {step === 3 && 'Machine connected'}
        </span>
      </div>

      {step === 1 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Install the SessionForge Agent</h3>
          <p className="text-xs text-gray-400 mb-4">
            Run this command on the machine you want to manage. The agent will connect automatically.
          </p>

          {/* OS Tabs */}
          <div className="flex gap-1 mb-3 border-b border-[#1e1e2e]">
            {tabs.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  tab === value
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Command */}
          <div className="relative rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] p-4 font-mono text-xs text-green-400">
            <pre className="whitespace-pre-wrap break-all pr-10">{command}</pre>
            <button
              onClick={copyCommand}
              className="absolute right-3 top-3 rounded p-1.5 text-gray-500 hover:text-white hover:bg-[#1e1e2e] transition-colors"
            >
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <div className="mt-4 rounded-lg bg-purple-500/5 border border-purple-500/20 p-3">
            <p className="text-xs text-purple-300">
              <strong>Requirements:</strong> The machine needs internet access and curl (Linux/macOS) or PowerShell 5+ (Windows).
            </p>
          </div>

          <Button className="mt-4" onClick={() => setStep(2)}>
            <Terminal className="h-4 w-4" />
            I ran the command
          </Button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Verify Connection</h3>
          <p className="text-xs text-gray-400 mb-6">
            Once the agent is running, click below to verify the connection.
          </p>

          {!verified ? (
            <div className="flex flex-col items-center py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1e1e2e] mb-4">
                <Monitor className="h-8 w-8 text-gray-500" />
              </div>
              <p className="text-sm text-gray-400 mb-6">Waiting for machine to connect...</p>
              <Button onClick={verifyConnection} isLoading={isVerifying}>
                <RefreshCw className="h-4 w-4" />
                {isVerifying ? 'Checking...' : 'Check Connection'}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20 mb-4">
                <CheckCircle className="h-8 w-8 text-green-400" />
              </div>
              <p className="text-sm font-medium text-white mb-1">Machine Connected!</p>
              <p className="text-xs text-gray-400">Your machine is now visible in the dashboard.</p>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="text-center py-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20 mx-auto mb-4">
            <CheckCircle className="h-8 w-8 text-purple-400" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">Setup Complete!</h3>
          <p className="text-sm text-gray-400 mb-6">
            Your machine is connected and ready. You can now start sessions and monitor it from the dashboard.
          </p>
          <Button onClick={onComplete}>View Dashboard</Button>
        </div>
      )}
    </div>
  )
}
