import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Acceptable Use Policy — SessionForge',
  description: 'SessionForge Acceptable Use Policy. Rules governing appropriate use of the platform.',
}

const EFFECTIVE_DATE = 'February 17, 2026'
const ABUSE_EMAIL = 'abuse@sessionforge.dev'
const LEGAL_EMAIL = 'legal@sessionforge.dev'

export default function AupPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Nav */}
      <nav className="border-b border-[#1e1e2e] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-[#8B5CF6] font-bold text-xl tracking-tight">
            SessionForge
          </Link>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/aup" className="text-white">Acceptable Use</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-10">
          <h1 className="text-4xl font-bold text-white mb-3">Acceptable Use Policy</h1>
          <p className="text-gray-400 text-sm">Effective Date: {EFFECTIVE_DATE}</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-10 text-gray-300 leading-relaxed">

          <p className="text-lg">
            This Acceptable Use Policy (&quot;AUP&quot;) defines the rules for using SessionForge. It is
            incorporated into our <Link href="/terms" className="text-[#8B5CF6] hover:underline">Terms of Service</Link> and
            applies to all users, organizations, and API integrations. Violations may result in
            immediate suspension or permanent termination without refund.
          </p>

          <Section title="1. Permitted Use">
            <p>SessionForge is designed for:</p>
            <ul>
              <li>Remote management of AI coding sessions (Claude Code, Cursor, terminal sessions)</li>
              <li>Monitoring the health and status of development machines</li>
              <li>Legitimate software development, testing, and DevOps workflows</li>
              <li>Team collaboration on authorized machines you own or have permission to access</li>
              <li>Automating legitimate development tasks via the SessionForge API</li>
            </ul>
          </Section>

          <Section title="2. Prohibited Activities">
            <p>
              The following uses are strictly prohibited. This list is not exhaustive — we reserve
              the right to determine what constitutes a violation.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-3">2.1 Illegal and Harmful Activities</h3>
            <ProhibitedList items={[
              'Using the Service for any purpose that violates applicable local, state, national, or international law',
              'Unauthorized access to systems, networks, or data of third parties ("hacking")',
              'Distributing malware, ransomware, spyware, or other malicious software via sessions',
              'Child sexual abuse material (CSAM) or any content that exploits minors',
              'Facilitating or participating in human trafficking or exploitation',
              'Fraud, phishing, or identity theft',
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.2 Network and Infrastructure Abuse</h3>
            <ProhibitedList items={[
              'Launching distributed denial-of-service (DDoS) attacks or participating in botnets',
              'Port scanning, network reconnaissance, or vulnerability scanning of networks you do not own',
              'Sending unsolicited bulk email (spam) or operating a spam relay',
              'Amplification attacks or traffic reflection through SessionForge infrastructure',
              'Attempting to circumvent rate limits, plan limits, or access controls',
              'Generating traffic patterns that unreasonably degrade service for other users',
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.3 Cryptomining</h3>
            <ProhibitedList items={[
              'Mining cryptocurrency (Bitcoin, Ethereum, Monero, or any other) using SessionForge sessions or the Agent',
              'Running proof-of-work computations for financial gain via the Service',
              'Any activity that primarily consumes CPU/GPU resources for financial gain rather than development',
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.4 Unauthorized Machine Access</h3>
            <ProhibitedList items={[
              'Installing the Agent on machines you do not own or do not have explicit permission to manage',
              'Using another user\'s API keys or account without authorization',
              'Accessing sessions or machines belonging to another organization',
              'Using the Service to gain unauthorized access to any system, account, or data',
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.5 Data Scraping and Automation Abuse</h3>
            <ProhibitedList items={[
              'Scraping third-party websites or services in violation of their terms of service',
              'Operating credential stuffing or brute-force attacks against any service',
              'Automating actions on third-party platforms in ways that violate those platforms\' policies',
              'Creating fake accounts, reviews, or engagement on any platform',
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.6 Platform Abuse</h3>
            <ProhibitedList items={[
              'Creating multiple free accounts to circumvent plan limits',
              'Reselling access to your SessionForge account or sessions without our written consent',
              'Reverse engineering, decompiling, or disassembling the proprietary SessionForge platform (the open-source Agent is exempt)',
              'Interfering with the integrity or performance of the Service',
              'Attempting to access another user\'s data or account',
              'Providing false information during account registration or support interactions',
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-3">2.7 Intellectual Property Violations</h3>
            <ProhibitedList items={[
              'Using the Service to infringe copyrights, trademarks, or other intellectual property rights',
              'Distributing pirated software or license keys through sessions',
              'Circumventing digital rights management (DRM) via sessions',
            ]} />
          </Section>

          <Section title="3. AI Session Guidelines">
            <p>
              SessionForge is built for managing AI coding sessions. When running AI tools
              (Claude Code, Cursor, Copilot, etc.) through our platform:
            </p>
            <ul>
              <li>You remain responsible for all code generated and actions taken by AI tools in your sessions</li>
              <li>AI-assisted actions that violate this AUP are your responsibility, regardless of automation</li>
              <li>You must comply with the terms of service of the AI tool you are running</li>
              <li>AI sessions that cause harm to third parties are not permitted</li>
            </ul>
          </Section>

          <Section title="4. Security Research">
            <p>
              We support legitimate security research. If you are conducting authorized penetration
              testing or vulnerability research:
            </p>
            <ul>
              <li>You must have written authorization from the owner of systems being tested</li>
              <li>Testing must not impact other SessionForge users or our infrastructure</li>
              <li>Responsible disclosure: report vulnerabilities in SessionForge itself to <EmailLink email={LEGAL_EMAIL} /></li>
            </ul>
            <p>
              We operate a responsible disclosure program. We will not pursue legal action against
              good-faith security researchers who follow these guidelines.
            </p>
          </Section>

          <Section title="5. API Usage">
            <p>If you access SessionForge programmatically via our API or Agent:</p>
            <ul>
              <li>Respect rate limits — do not attempt to circumvent them</li>
              <li>Do not share API keys publicly (GitHub repos, Slack, Discord, etc.)</li>
              <li>Rotate API keys immediately if compromised</li>
              <li>API integrations must comply with all sections of this AUP</li>
              <li>Do not use the API to harvest data about our platform or other users</li>
            </ul>
          </Section>

          <Section title="6. Enforcement">
            <h3 className="text-white font-semibold mt-4 mb-2">6.1 Actions We May Take</h3>
            <p>
              In response to violations, we may take any of the following actions at our discretion:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              {[
                { level: 'Warning', color: 'border-yellow-500/30 bg-yellow-500/5', text: 'Email warning with details of the violation and required action' },
                { level: 'Suspension', color: 'border-orange-500/30 bg-orange-500/5', text: 'Temporary suspension of account or specific features, with or without notice' },
                { level: 'Termination', color: 'border-red-500/30 bg-red-500/5', text: 'Permanent termination of account with no refund for severe or repeated violations' },
              ].map(({ level, color, text }) => (
                <div key={level} className={`p-4 rounded-lg border ${color}`}>
                  <div className="font-semibold text-white mb-2">{level}</div>
                  <div className="text-sm text-gray-400">{text}</div>
                </div>
              ))}
            </div>

            <h3 className="text-white font-semibold mt-6 mb-2">6.2 Immediate Termination</h3>
            <p>
              The following violations result in immediate account termination without warning
              or refund:
            </p>
            <ul>
              <li>CSAM or content that exploits minors</li>
              <li>Active DDoS attacks or botnet operation</li>
              <li>Cryptomining at scale</li>
              <li>Unauthorized access to third-party systems</li>
              <li>Any activity posing an immediate risk to our infrastructure or other users</li>
            </ul>

            <h3 className="text-white font-semibold mt-6 mb-2">6.3 Legal Action</h3>
            <p>
              We will cooperate with law enforcement and may pursue civil or criminal legal action
              for violations involving illegal activity, fraud, or significant harm to our
              platform, users, or third parties.
            </p>
          </Section>

          <Section title="7. Reporting Abuse">
            <p>
              If you observe a violation of this AUP or suspect your account has been compromised:
            </p>
            <div className="p-4 bg-[#111118] border border-[#1e1e2e] rounded-lg mt-3">
              <p className="text-white font-medium mb-2">Report abuse:</p>
              <p>Email: <EmailLink email={ABUSE_EMAIL} /></p>
              <p className="text-sm text-gray-400 mt-2">
                Please include: your account email (if applicable), description of the violation,
                affected URLs or session IDs, and any supporting evidence. We will investigate
                all reports and respond within 2 business days.
              </p>
            </div>
            <p>
              For security vulnerabilities in SessionForge itself, see our responsible disclosure
              policy at <EmailLink email={LEGAL_EMAIL} />.
            </p>
          </Section>

          <Section title="8. Changes to This Policy">
            <p>
              We may update this AUP to address new use cases or threats. Material changes will
              be communicated by email with 14 days notice. Continued use of the Service after
              changes take effect constitutes acceptance.
            </p>
          </Section>

        </div>
      </main>

      <Footer />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-white mb-4 pb-2 border-b border-[#1e1e2e]">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function ProhibitedList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="text-red-400 mt-1 shrink-0">✕</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function EmailLink({ email }: { email: string }) {
  return <a href={`mailto:${email}`} className="text-[#8B5CF6] hover:underline">{email}</a>
}

function Footer() {
  return (
    <footer className="border-t border-[#1e1e2e] mt-24 py-8">
      <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
        <p>© {new Date().getFullYear()} SessionForge LLC. All rights reserved.</p>
        <div className="flex items-center gap-6">
          <Link href="/terms" className="hover:text-gray-300 transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-gray-300 transition-colors">Privacy</Link>
          <Link href="/aup" className="hover:text-gray-300 transition-colors">Acceptable Use</Link>
          <Link href="/" className="hover:text-gray-300 transition-colors">Home</Link>
        </div>
      </div>
    </footer>
  )
}
