import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Contact — SessionForge',
  description: 'Get in touch with the SessionForge team. We\'re here to help.',
}

export default function ContactPage() {
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
            <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
            <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="border-b border-[#1e1e2e] px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm text-purple-400 font-medium mb-3">Contact</p>
          <h1 className="text-4xl font-bold mb-4">Get in touch</h1>
          <p className="text-gray-400 text-lg max-w-xl">
            Have a question, need help with your account, or want to discuss an enterprise plan? We&apos;d love to hear from you.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-12">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12">

          {/* Contact options */}
          <div className="space-y-6">
            <div className="border border-[#1e1e2e] rounded-xl p-6 hover:border-[#2a2a3e] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <h2 className="font-semibold text-white mb-1">General inquiries</h2>
              <p className="text-sm text-gray-400 mb-3">Questions about SessionForge, pricing, or getting started.</p>
              <a
                href="mailto:hello@sessionforge.dev"
                className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                hello@sessionforge.dev
              </a>
            </div>

            <div className="border border-[#1e1e2e] rounded-xl p-6 hover:border-[#2a2a3e] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h2 className="font-semibold text-white mb-1">Support</h2>
              <p className="text-sm text-gray-400 mb-3">Need help with your account or technical issues?</p>
              <a
                href="mailto:support@sessionforge.dev"
                className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                support@sessionforge.dev
              </a>
            </div>

            <div className="border border-[#1e1e2e] rounded-xl p-6 hover:border-[#2a2a3e] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                </svg>
              </div>
              <h2 className="font-semibold text-white mb-1">Enterprise</h2>
              <p className="text-sm text-gray-400 mb-3">Custom plans, SSO, SLAs, and volume pricing for your team.</p>
              <a
                href="mailto:enterprise@sessionforge.dev"
                className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                enterprise@sessionforge.dev
              </a>
            </div>

            <div className="border border-[#1e1e2e] rounded-xl p-6 hover:border-[#2a2a3e] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <h2 className="font-semibold text-white mb-1">Privacy &amp; security</h2>
              <p className="text-sm text-gray-400 mb-3">Data requests, privacy questions, and security vulnerability reports.</p>
              <a
                href="mailto:privacy@sessionforge.dev"
                className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                privacy@sessionforge.dev
              </a>
            </div>
          </div>

          {/* FAQ / quick answers */}
          <div>
            <h2 className="text-lg font-semibold mb-6">Common questions</h2>
            <div className="space-y-5">
              {[
                {
                  q: 'How quickly do you respond?',
                  a: 'We aim to respond to all emails within one business day. Enterprise customers get priority support with a 4-hour SLA.',
                },
                {
                  q: 'Do you offer a free trial?',
                  a: 'Yes — sign up for free and get 1 machine and 1 active session included at no cost, no credit card required.',
                },
                {
                  q: 'Can I self-host SessionForge?',
                  a: 'Self-hosted is on our roadmap for Enterprise customers. Email us at enterprise@sessionforge.dev to discuss your needs.',
                },
                {
                  q: 'What operating systems does the agent support?',
                  a: 'The SessionForge Agent runs on Linux (x64/arm64), macOS (Intel + Apple Silicon), and Windows 10/11.',
                },
                {
                  q: 'Where is my data stored?',
                  a: 'All data is stored in Google Cloud Platform (us-central1). See our Privacy Policy for full details on data handling and retention.',
                },
              ].map((item) => (
                <div key={item.q} className="border-b border-[#1e1e2e] pb-5 last:border-0">
                  <p className="font-medium text-white text-sm mb-2">{item.q}</p>
                  <p className="text-sm text-gray-400 leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 bg-purple-500/5 border border-purple-500/20 rounded-xl p-5">
              <p className="text-sm font-medium text-white mb-1">Need help right now?</p>
              <p className="text-xs text-gray-400 mb-3">
                Check our documentation for installation guides, API reference, and troubleshooting tips.
              </p>
              <Link
                href="/docs"
                className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors font-medium"
              >
                Browse the docs
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[#1e1e2e] px-6 py-8 mt-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-gray-600">
          <span>© {new Date().getFullYear()} SessionForge LLC. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-gray-400 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-400 transition-colors">Terms</Link>
            <Link href="/docs" className="hover:text-gray-400 transition-colors">Docs</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
