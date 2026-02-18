import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy — SessionForge',
  description: 'SessionForge Privacy Policy. How we collect, use, and protect your personal data.',
}

const EFFECTIVE_DATE = 'February 17, 2026'
const CONTACT_EMAIL = 'privacy@sessionforge.dev'

export default function PrivacyPage() {
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
            <Link href="/privacy" className="text-white">Privacy</Link>
            <Link href="/aup" className="hover:text-white transition-colors">Acceptable Use</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-10">
          <h1 className="text-4xl font-bold text-white mb-3">Privacy Policy</h1>
          <p className="text-gray-400 text-sm">Effective Date: {EFFECTIVE_DATE}</p>
          <p className="text-gray-400 text-sm mt-1">
            This policy applies to sessionforge.dev and all SessionForge services.
          </p>
        </div>

        <div className="prose prose-invert max-w-none space-y-10 text-gray-300 leading-relaxed">

          <Section title="1. Who We Are">
            <p>
              SessionForge is operated by SessionForge LLC, a company registered in the
              Commonwealth of Massachusetts, USA. We are the data controller for personal data
              collected through our platform.
            </p>
            <p>
              Privacy questions: <EmailLink email={CONTACT_EMAIL} />
            </p>
          </Section>

          <Section title="2. What Data We Collect">
            <h3 className="text-white font-semibold mt-4 mb-2">2.1 Account Data</h3>
            <DataTable rows={[
              ['Email address', 'Required for account creation, login, and transactional emails'],
              ['Name', 'Optional — displayed in dashboard and emails'],
              ['Password hash', 'bcrypt hash only — we never store your plain-text password'],
              ['Profile photo URL', 'From OAuth providers (Google/GitHub) only, if provided'],
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-2">2.2 Machine Data (from Agent)</h3>
            <p>
              When you install the SessionForge Agent, it transmits the following every 30 seconds:
            </p>
            <DataTable rows={[
              ['Hostname', 'Machine identifier for your dashboard'],
              ['Operating system', 'OS type and version (Windows/macOS/Linux)'],
              ['CPU usage (%)', 'Aggregate — no process list or individual app data'],
              ['Memory usage (%)', 'Total used/available — no process-level memory'],
              ['Disk usage (%)', 'Total used/available for primary disk'],
              ['Agent version', 'Version of the SessionForge Agent installed'],
              ['Public IP address', 'Used for machine identification and security'],
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-2">2.3 Session Data (Terminal I/O)</h3>
            <p>
              Terminal session input (keystrokes) and output (screen content) are transmitted
              in real time via WebSocket and temporarily buffered in Redis (up to 2,000 lines).
              Sessions are flushed to Google Cloud Storage and retained according to your plan:
            </p>
            <ul>
              <li><strong className="text-white">Free:</strong> 24 hours</li>
              <li><strong className="text-white">Pro:</strong> 30 days</li>
              <li><strong className="text-white">Team:</strong> 90 days</li>
              <li><strong className="text-white">Enterprise:</strong> 1 year</li>
            </ul>
            <p>
              <strong className="text-white">Important:</strong> Session logs may contain sensitive
              information (code, credentials, API keys). You are responsible for not typing
              sensitive data you do not wish to be stored.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">2.4 Usage and Log Data</h3>
            <DataTable rows={[
              ['Login timestamps', 'When you log in and from which IP'],
              ['API key usage', 'Which key was used, timestamp, and endpoint — not session content'],
              ['Billing events', 'Plan changes, payment timestamps — no card details'],
              ['Error logs', 'Application errors for debugging (via Sentry)'],
              ['Access logs', 'HTTP request logs (method, path, status, response time)'],
            ]} />

            <h3 className="text-white font-semibold mt-6 mb-2">2.5 Cookies</h3>
            <DataTable rows={[
              ['next-auth.session-token', 'Strictly necessary — httpOnly session cookie for authentication. 30-day expiry.'],
              ['__Secure-next-auth.session-token', 'Production variant of the above (Secure flag).'],
            ]} />
            <p>
              We do not use advertising cookies, tracking pixels, or third-party analytics cookies.
              We do not use Google Analytics.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">2.6 Payment Data</h3>
            <p>
              We use Stripe for payment processing. We never see or store your full credit card
              number, CVV, or bank account details. Stripe stores this data under PCI DSS
              compliance. We store only your Stripe Customer ID and subscription status.
            </p>
          </Section>

          <Section title="3. How We Use Your Data">
            <DataTable rows={[
              ['Account data', 'Provide and personalize the Service; send transactional emails', 'Contract performance'],
              ['Machine metrics', 'Display on your dashboard; detect offline machines', 'Contract performance'],
              ['Session data', 'Enable real-time terminal access; provide session history', 'Contract performance'],
              ['Usage logs', 'Debug issues; monitor for abuse; improve performance', 'Legitimate interest'],
              ['Error logs', 'Fix bugs and improve reliability', 'Legitimate interest'],
              ['Email address', 'Send transactional emails (verify, reset, invoice, alerts)', 'Contract performance'],
              ['Payment data', 'Process subscriptions; detect fraud', 'Contract performance'],
            ]} headers={['Data', 'Purpose', 'Legal Basis (GDPR)']} />
            <p>
              We do not sell your personal data. We do not use your data for advertising.
              We do not train AI models on your session content.
            </p>
          </Section>

          <Section title="4. Third-Party Services">
            <p>We share data with the following trusted third parties to operate the Service:</p>
            <DataTable rows={[
              ['Stripe', 'Payment processing, subscription management, tax collection', 'United States', 'stripe.com/privacy'],
              ['Resend', 'Transactional email delivery', 'United States', 'resend.com/privacy'],
              ['Google Cloud', 'Cloud infrastructure (database, storage, compute)', 'United States', 'cloud.google.com/privacy'],
              ['Google OAuth', 'Optional login via Google account', 'United States', 'policies.google.com/privacy'],
              ['GitHub OAuth', 'Optional login via GitHub account', 'United States', 'docs.github.com/en/site-policy/privacy-policies'],
              ['Sentry', 'Error tracking and performance monitoring', 'United States', 'sentry.io/privacy'],
              ['Axiom', 'Application log storage and search', 'United States', 'axiom.co/privacy'],
            ]} headers={['Provider', 'Purpose', 'Location', 'Privacy Policy']} />
            <p>
              Each of these providers has signed a Data Processing Agreement (DPA) with us or
              operates under Standard Contractual Clauses for international data transfers.
            </p>
          </Section>

          <Section title="5. Data Storage and Security">
            <p>
              All data is stored in Google Cloud Platform infrastructure in the United States
              (us-central1 region). We implement the following security measures:
            </p>
            <ul>
              <li>TLS 1.2+ encryption in transit for all data</li>
              <li>AES-256 encryption at rest (Google Cloud default)</li>
              <li>API keys stored as SHA-256 hashes — never in plain text</li>
              <li>Passwords stored as bcrypt hashes (cost factor 12)</li>
              <li>Access logs and audit trails for all administrative actions</li>
              <li>Least-privilege access controls for staff</li>
              <li>Regular dependency security audits via <code>npm audit</code> and <code>govulncheck</code></li>
            </ul>
            <p>
              No security measure is 100% effective. In the event of a data breach affecting your
              personal data, we will notify you within 72 hours as required by GDPR and applicable
              state law.
            </p>
          </Section>

          <Section title="6. Data Retention">
            <DataTable rows={[
              ['Account data', 'Until account deletion + 30 days'],
              ['Session logs', '24h (Free) / 30 days (Pro) / 90 days (Team) / 1 year (Enterprise)'],
              ['Machine metrics', 'Rolling 30-day history'],
              ['Payment records', '7 years (legal/tax requirement)'],
              ['Access logs', '90 days'],
              ['Error logs (Sentry)', '90 days'],
              ['Verification tokens', 'Until used or expired (24 hours)'],
            ]} />
          </Section>

          <Section title="7. Your Rights">
            <p>
              Depending on your location, you have the following rights regarding your personal data:
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">7.1 All Users</h3>
            <ul>
              <li><strong className="text-white">Access:</strong> Request a copy of personal data we hold about you</li>
              <li><strong className="text-white">Correction:</strong> Update inaccurate data via account settings or by contacting us</li>
              <li><strong className="text-white">Deletion:</strong> Request deletion of your account and associated data</li>
              <li><strong className="text-white">Portability:</strong> Receive your session logs and account data in a machine-readable format</li>
            </ul>

            <h3 className="text-white font-semibold mt-6 mb-2">7.2 EU/EEA/UK Residents (GDPR)</h3>
            <ul>
              <li><strong className="text-white">Restriction:</strong> Request that we limit processing of your data</li>
              <li><strong className="text-white">Object:</strong> Object to processing based on legitimate interest</li>
              <li><strong className="text-white">Lodge a complaint:</strong> With your national data protection authority</li>
              <li><strong className="text-white">Withdraw consent:</strong> Where processing is based on consent</li>
            </ul>

            <h3 className="text-white font-semibold mt-6 mb-2">7.3 California Residents (CCPA)</h3>
            <ul>
              <li><strong className="text-white">Know:</strong> What categories of personal information we collect and why</li>
              <li><strong className="text-white">Delete:</strong> Your personal information (subject to exceptions)</li>
              <li><strong className="text-white">Opt-out of sale:</strong> We do not sell personal information — no action needed</li>
              <li><strong className="text-white">Non-discrimination:</strong> We will not discriminate for exercising your rights</li>
            </ul>

            <p>
              To exercise any right, email <EmailLink email={CONTACT_EMAIL} />. We will respond
              within 30 days (GDPR) or 45 days (CCPA). We may require identity verification before
              processing requests.
            </p>
          </Section>

          <Section title="8. Children's Privacy">
            <p>
              The Service is not directed to children under 18. We do not knowingly collect
              personal data from children. If you believe we have collected data from a child
              under 18, contact us at <EmailLink email={CONTACT_EMAIL} /> and we will delete it.
            </p>
          </Section>

          <Section title="9. International Transfers">
            <p>
              We are based in the United States. If you access the Service from outside the US,
              your data is transferred to and processed in the US. For users in the EU/EEA/UK,
              we rely on Standard Contractual Clauses (SCCs) approved by the European Commission
              as the transfer mechanism for international data transfers.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy to reflect changes in our practices or applicable
              law. For material changes, we will notify you by email at least 30 days before the
              change takes effect. The effective date above will be updated with each revision.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>For privacy questions, rights requests, or to report a concern:</p>
            <address className="not-italic mt-3 p-4 bg-[#111118] border border-[#1e1e2e] rounded-lg text-sm">
              SessionForge LLC — Privacy<br />
              Email: <EmailLink email={CONTACT_EMAIL} /><br />
              Response time: Within 5 business days for general questions; within 30 days for formal rights requests.
            </address>
            <p className="mt-4">
              For EU/EEA residents: if you are unsatisfied with our response, you have the right
              to lodge a complaint with your local supervisory authority.
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

function EmailLink({ email }: { email: string }) {
  return <a href={`mailto:${email}`} className="text-[#8B5CF6] hover:underline">{email}</a>
}

function DataTable({ rows, headers }: { rows: string[][]; headers?: string[] }) {
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-sm border-collapse border border-[#1e1e2e] rounded">
        {headers && (
          <thead>
            <tr className="border-b border-[#1e1e2e] bg-[#111118]">
              {headers.map((h) => (
                <th key={h} className="text-left p-3 text-white font-medium">{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[#1e1e2e] last:border-0">
              {row.map((cell, j) => (
                <td key={j} className={`p-3 align-top ${j === 0 ? 'text-white font-medium whitespace-nowrap' : ''}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
