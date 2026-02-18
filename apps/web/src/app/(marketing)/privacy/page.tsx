export const metadata = {
  title: 'Privacy Policy — SessionForge',
  description: 'Privacy Policy for SessionForge.',
}

const EFFECTIVE_DATE = 'February 18, 2026'

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">Privacy Policy</h1>
        <p className="text-sm text-gray-500">Effective date: {EFFECTIVE_DATE}</p>
      </div>

      <div className="space-y-8 text-gray-300 text-sm leading-relaxed">

        <p>
          SessionForge Inc. ("we", "us", or "our") operates sessionforge.dev. This Privacy Policy
          explains what information we collect, how we use it, and your rights regarding that
          information. By using the Service you agree to the practices described here.
        </p>

        <Section title="1. Information We Collect">
          <p><strong className="text-white">Account information:</strong> When you register we collect your name, email address, and a hashed password. OAuth sign-ins share your name, email, and profile picture from the provider.</p>
          <p><strong className="text-white">Usage data:</strong> We log API requests, session activity, machine connections, and feature usage to operate and improve the Service.</p>
          <p><strong className="text-white">Payment information:</strong> Payments are processed by Stripe. We store only your billing plan and the last four digits of your card — never the full card number.</p>
          <p><strong className="text-white">Technical data:</strong> We collect IP addresses, browser type, operating system, and timestamps to detect abuse and secure the Service.</p>
          <p><strong className="text-white">Session content:</strong> Terminal I/O and agent output are stored temporarily (up to 7 days) to power the real-time dashboard. You can delete sessions at any time.</p>
        </Section>

        <Section title="2. How We Use Your Information">
          <ul className="space-y-2 list-disc list-inside text-gray-400">
            <li>Provide, maintain, and improve the Service</li>
            <li>Authenticate you and secure your account</li>
            <li>Send transactional emails (verification, billing receipts, security alerts)</li>
            <li>Detect and prevent fraud, abuse, and security threats</li>
            <li>Comply with legal obligations</li>
            <li>Respond to your support requests</li>
          </ul>
          <p className="mt-3">
            We do not sell your personal data. We do not use your data to train AI models.
          </p>
        </Section>

        <Section title="3. Third-Party Services">
          <p>We share data with the following sub-processors to operate the Service:</p>
          <div className="mt-3 rounded-lg border border-[#1e1e2e] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e] bg-[#111118]">
                  <th className="px-4 py-2 text-left text-gray-400 font-medium">Provider</th>
                  <th className="px-4 py-2 text-left text-gray-400 font-medium">Purpose</th>
                  <th className="px-4 py-2 text-left text-gray-400 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e1e2e]">
                <tr>
                  <td className="px-4 py-2 text-white">Google Cloud</td>
                  <td className="px-4 py-2 text-gray-400">Hosting & infrastructure</td>
                  <td className="px-4 py-2 text-gray-400">US</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-white">Upstash</td>
                  <td className="px-4 py-2 text-gray-400">Redis cache & rate limiting</td>
                  <td className="px-4 py-2 text-gray-400">US</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-white">Stripe</td>
                  <td className="px-4 py-2 text-gray-400">Payment processing</td>
                  <td className="px-4 py-2 text-gray-400">US</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-white">Resend</td>
                  <td className="px-4 py-2 text-gray-400">Transactional email</td>
                  <td className="px-4 py-2 text-gray-400">US</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-white">Sentry</td>
                  <td className="px-4 py-2 text-gray-400">Error monitoring</td>
                  <td className="px-4 py-2 text-gray-400">US</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="4. Cookies and Tracking">
          <p>
            We use a single session cookie (<code className="text-purple-300 text-xs">next-auth.session-token</code>) to keep you signed in. We do not use advertising cookies or cross-site tracking pixels. We use Sentry for error monitoring, which may collect technical metadata about your browser session.
          </p>
        </Section>

        <Section title="5. Data Retention">
          <p>
            We retain your account data for as long as your account is active. Session logs are
            retained for up to 7 days. You may request deletion of your account and all associated
            data at any time by emailing{' '}
            <a href="mailto:privacy@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              privacy@sessionforge.dev
            </a>
            . We will process your request within 30 days.
          </p>
        </Section>

        <Section title="6. Security">
          <p>
            We protect your data using industry-standard practices: TLS in transit, encrypted
            passwords (bcrypt), and scoped database access. We perform regular security reviews and
            rate-limit authentication endpoints. No system is perfectly secure; please report
            vulnerabilities to{' '}
            <a href="mailto:security@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              security@sessionforge.dev
            </a>
            .
          </p>
        </Section>

        <Section title="7. Your Rights">
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul className="mt-3 space-y-2 list-disc list-inside text-gray-400">
            <li>Access the personal data we hold about you</li>
            <li>Correct inaccurate data</li>
            <li>Request deletion of your data</li>
            <li>Export your data in a machine-readable format</li>
            <li>Object to or restrict processing of your data</li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email{' '}
            <a href="mailto:privacy@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              privacy@sessionforge.dev
            </a>
            .
          </p>
        </Section>

        <Section title="8. Children's Privacy">
          <p>
            The Service is not directed at children under 16. We do not knowingly collect personal
            data from anyone under 16. If you believe a child has provided us with personal data,
            contact us and we will delete it promptly.
          </p>
        </Section>

        <Section title="9. International Transfers">
          <p>
            SessionForge is based in the United States. If you access the Service from outside the
            US, your data may be transferred to and processed in the US, which may have different
            data protection laws than your country. By using the Service, you consent to this transfer.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes by email or in-app notice at least 14 days before they take effect.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Questions about this policy? Email{' '}
            <a href="mailto:privacy@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              privacy@sessionforge.dev
            </a>
            .
          </p>
        </Section>

      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-white mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
