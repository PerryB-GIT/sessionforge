import Link from 'next/link'
import { ArrowRight, Check, Monitor, Terminal, Globe, Zap, Shield, BarChart3, Users, Building2 } from 'lucide-react'

const features = [
  {
    icon: Globe,
    title: 'Remote Access',
    description:
      'Connect to any Claude Code session from anywhere in the world. Browser-based terminal with zero latency.',
  },
  {
    icon: Monitor,
    title: 'Multi-Machine',
    description:
      'Manage a fleet of machines from a single dashboard. Track CPU, memory, and session status in real time.',
  },
  {
    icon: Terminal,
    title: 'Real-time Terminal',
    description:
      'Full xterm.js terminal with WebSocket I/O. Send input, view output, resize — exactly like you\'re there.',
  },
]

const plans = [
  {
    name: 'Free',
    price: 0,
    description: 'For individuals getting started',
    icon: Zap,
    color: 'text-gray-400',
    borderColor: 'border-[#1e1e2e]',
    features: [
      '1 machine',
      '3 concurrent sessions',
      '1-day session history',
      'Community support',
    ],
    cta: 'Start free',
    ctaVariant: 'outline' as const,
    href: '/signup',
  },
  {
    name: 'Pro',
    price: 19,
    description: 'For professional developers',
    icon: Zap,
    color: 'text-purple-400',
    borderColor: 'border-purple-500/50',
    popular: true,
    features: [
      '5 machines',
      'Unlimited sessions',
      '30-day history',
      'API access & webhooks',
      'Priority support',
    ],
    cta: 'Get Pro',
    ctaVariant: 'default' as const,
    href: '/signup?plan=pro',
  },
  {
    name: 'Team',
    price: 49,
    description: 'For growing engineering teams',
    icon: Users,
    color: 'text-blue-400',
    borderColor: 'border-[#1e1e2e]',
    features: [
      '20 machines',
      'Unlimited sessions',
      '90-day history',
      'Team invites (10 seats)',
      'RBAC & shared sessions',
      'Webhook integrations',
    ],
    cta: 'Get Team',
    ctaVariant: 'outline' as const,
    href: '/signup?plan=team',
  },
  {
    name: 'Enterprise',
    price: 199,
    description: 'For large organizations',
    icon: Building2,
    color: 'text-yellow-400',
    borderColor: 'border-[#1e1e2e]',
    features: [
      'Unlimited machines',
      'Unlimited sessions & seats',
      '365-day history',
      'SSO & audit logs',
      'Custom branding',
      'IP allowlist',
      'SLA & dedicated support',
    ],
    cta: 'Contact Sales',
    ctaVariant: 'outline' as const,
    href: '/contact',
  },
]

// Terminal animation demo component (static version for server render)
function TerminalDemo() {
  return (
    <div className="rounded-xl border border-[#1e1e2e] bg-[#0a0a0f] overflow-hidden shadow-2xl shadow-purple-500/10">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1e1e2e] bg-[#111118]">
        <div className="h-3 w-3 rounded-full bg-red-500/70" />
        <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <div className="h-3 w-3 rounded-full bg-green-500/70" />
        <span className="ml-3 text-xs text-gray-600 font-mono">sessionforge — dashboard</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-green-400">3 sessions active</span>
        </div>
      </div>

      {/* Terminal content */}
      <div className="p-4 font-mono text-xs space-y-1 leading-relaxed">
        <div className="text-gray-600">$ sessionforge connect --machine dev-server-01</div>
        <div className="text-green-400">Connected to dev-server-01 (Ubuntu 22.04)</div>
        <div className="text-gray-600 mt-2">$ claude</div>
        <div className="text-purple-300">Claude Code v1.0.0 — AI-powered development</div>
        <div className="text-gray-500">Analyzing project structure...</div>
        <div className="text-white mt-1">
          <span className="text-gray-500">&gt; </span>
          What would you like to build today?
        </div>
        <div className="text-gray-300">Let's add authentication to the API.</div>
        <div className="mt-1 text-gray-500">&gt; Planning authentication implementation...</div>
        <div className="text-gray-400">- POST /auth/register</div>
        <div className="text-gray-400">- POST /auth/login (JWT)</div>
        <div className="text-gray-400">- POST /auth/refresh</div>
        <div className="text-gray-400">- DELETE /auth/logout</div>
        <div className="mt-1">
          <span className="text-green-400">Creating files... </span>
          <span className="text-gray-500">src/auth/router.ts</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">$</span>
          <span className="inline-block h-3 w-1.5 bg-purple-400 animate-pulse ml-1" />
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Nav */}
      <nav className="border-b border-[#1e1e2e] bg-[#0a0a0f]/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">SessionForge</span>
            </div>
            <div className="hidden sm:flex items-center gap-6">
              <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">
                Features
              </a>
              <a href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">
                Pricing
              </a>
              <a href="/docs" className="text-sm text-gray-400 hover:text-white transition-colors">
                Docs
              </a>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-600 transition-colors"
              >
                Get started free
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-20 pb-32">
        {/* Background gradient */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-purple-500/5 blur-3xl" />
          <div className="absolute top-0 right-0 h-[400px] w-[400px] rounded-full bg-purple-700/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left: copy */}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/5 px-3 py-1 text-xs text-purple-300 mb-6">
                <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                Now in public beta
              </div>
              <h1 className="text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
                Manage Claude{' '}
                <span className="gradient-text">from anywhere</span>
              </h1>
              <p className="text-lg text-gray-400 mb-8 leading-relaxed">
                SessionForge gives you a real-time dashboard for every Claude Code session across all
                your machines. Start, stop, monitor, and interact — from any browser.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-500 px-6 py-3 text-base font-medium text-white hover:bg-purple-600 transition-colors shadow-lg shadow-purple-500/20"
                >
                  Start free
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/docs"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#1e1e2e] px-6 py-3 text-base font-medium text-gray-300 hover:bg-[#1e1e2e] hover:text-white transition-colors"
                >
                  View docs
                </Link>
              </div>

              {/* Social proof */}
              <div className="flex items-center gap-4 mt-8 pt-8 border-t border-[#1e1e2e]">
                <div className="text-center">
                  <div className="text-2xl font-bold text-white">500+</div>
                  <div className="text-xs text-gray-500">Developers</div>
                </div>
                <div className="h-8 w-px bg-[#1e1e2e]" />
                <div className="text-center">
                  <div className="text-2xl font-bold text-white">10k+</div>
                  <div className="text-xs text-gray-500">Sessions managed</div>
                </div>
                <div className="h-8 w-px bg-[#1e1e2e]" />
                <div className="text-center">
                  <div className="text-2xl font-bold text-white">99.9%</div>
                  <div className="text-xs text-gray-500">Uptime</div>
                </div>
              </div>
            </div>

            {/* Right: terminal demo */}
            <div className="relative">
              <div className="absolute -inset-4 rounded-2xl bg-purple-500/5 blur-2xl" />
              <div className="relative">
                <TerminalDemo />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 border-t border-[#1e1e2e]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">
              Everything you need to manage AI sessions
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Built for developers who run Claude Code on multiple machines and need visibility into
              what's happening across their fleet.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {features.map((feature) => {
              const Icon = feature.icon
              return (
                <div
                  key={feature.title}
                  className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-6 hover:border-purple-500/30 transition-colors group"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 mb-4 group-hover:bg-purple-500/15 transition-colors">
                    <Icon className="h-5 w-5 text-purple-400" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
                </div>
              )
            })}
          </div>

          {/* Additional feature highlights */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
            {[
              { icon: Shield, label: 'End-to-end encrypted' },
              { icon: BarChart3, label: 'Real-time metrics' },
              { icon: Zap, label: 'Sub-second latency' },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border border-[#1e1e2e] bg-[#111118] px-4 py-3"
              >
                <Icon className="h-4 w-4 text-purple-400 shrink-0" />
                <span className="text-sm text-gray-300">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 border-t border-[#1e1e2e]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">Simple, transparent pricing</h2>
            <p className="text-gray-400">Start free, upgrade when you need more power.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((plan) => {
              const Icon = plan.icon
              return (
                <div
                  key={plan.name}
                  className={`relative rounded-xl border ${plan.borderColor} bg-[#111118] p-6 flex flex-col ${
                    plan.popular ? 'ring-1 ring-purple-500' : ''
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="inline-flex items-center rounded-full bg-purple-500 px-3 py-0.5 text-xs font-semibold text-white">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-4">
                    <Icon className={`h-5 w-5 ${plan.color}`} />
                    <span className="font-semibold text-white">{plan.name}</span>
                  </div>

                  <div className="mb-1">
                    <span className="text-3xl font-bold text-white">
                      {plan.price === 0 ? 'Free' : `$${plan.price}`}
                    </span>
                    {plan.price > 0 && <span className="text-sm text-gray-500">/mo</span>}
                  </div>
                  <p className="text-xs text-gray-500 mb-6">{plan.description}</p>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-400 shrink-0" />
                        <span className="text-gray-300">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={plan.href}
                    className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      plan.ctaVariant === 'default'
                        ? 'bg-purple-500 text-white hover:bg-purple-600'
                        : 'border border-[#1e1e2e] text-gray-300 hover:bg-[#1e1e2e] hover:text-white'
                    }`}
                  >
                    {plan.cta}
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-24 border-t border-[#1e1e2e]">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-12">
            <h2 className="text-3xl font-bold text-white mb-4">
              Ready to take control of your sessions?
            </h2>
            <p className="text-gray-400 mb-8">
              Join developers who use SessionForge to manage their AI workflows from anywhere.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-purple-500 px-8 py-3 text-base font-medium text-white hover:bg-purple-600 transition-colors shadow-lg shadow-purple-500/20"
              >
                Start free today
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/docs"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                View documentation →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1e1e2e] py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-purple-500">
                <Zap className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-medium text-white">SessionForge</span>
            </div>
            <div className="flex gap-6">
              <a href="/privacy" className="text-sm text-gray-500 hover:text-white transition-colors">
                Privacy
              </a>
              <a href="/terms" className="text-sm text-gray-500 hover:text-white transition-colors">
                Terms
              </a>
              <a href="/docs" className="text-sm text-gray-500 hover:text-white transition-colors">
                Docs
              </a>
            </div>
            <p className="text-xs text-gray-600">&copy; 2024 SessionForge. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
