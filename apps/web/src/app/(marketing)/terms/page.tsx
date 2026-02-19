import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service — SessionForge',
  description: 'SessionForge Terms of Service. Read the terms governing your use of the SessionForge platform.',
}

const EFFECTIVE_DATE = 'February 17, 2026'
const COMPANY = 'SessionForge LLC'
const GOVERNING_STATE = 'Massachusetts'
const CONTACT_EMAIL = 'legal@sessionforge.dev'
const SERVICE_URL = 'https://sessionforge.dev'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Nav */}
      <nav className="border-b border-[#1e1e2e] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-[#8B5CF6] font-bold text-xl tracking-tight">
            SessionForge
          </Link>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <Link href="/terms" className="text-white">Terms</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/aup" className="hover:text-white transition-colors">Acceptable Use</Link>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-10">
          <h1 className="text-4xl font-bold text-white mb-3">Terms of Service</h1>
          <p className="text-gray-400 text-sm">Effective Date: {EFFECTIVE_DATE}</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-10 text-gray-300 leading-relaxed">

          <Section title="1. Acceptance of Terms">
            <p>
              These Terms of Service (&quot;Terms&quot;) form a legally binding agreement between you and {COMPANY}
              (&quot;SessionForge,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) governing your access to and use of the
              SessionForge platform, including the web dashboard, API, desktop agent, and all related
              services (collectively, the &quot;Service&quot;) available at{' '}
              <a href={SERVICE_URL} className="text-[#8B5CF6] hover:underline">{SERVICE_URL}</a>.
            </p>
            <p>
              By creating an account, clicking &quot;Sign up,&quot; or otherwise accessing or using the Service,
              you agree to be bound by these Terms and our{' '}
              <Link href="/privacy" className="text-[#8B5CF6] hover:underline">Privacy Policy</Link>.
              If you do not agree, do not use the Service.
            </p>
            <p>
              If you are using the Service on behalf of an organization, you represent that you have
              authority to bind that organization to these Terms, and &quot;you&quot; refers to both you and
              that organization.
            </p>
          </Section>

          <Section title="2. Description of Service">
            <p>
              SessionForge is a Software-as-a-Service (SaaS) platform that enables users to remotely
              manage, monitor, and access AI coding sessions (including Claude Code and other terminal
              sessions) running on machines where the SessionForge Agent is installed. The Service
              provides a web-based dashboard, real-time terminal access via WebSocket, machine
              monitoring, session lifecycle management, and API access.
            </p>
            <p>
              The SessionForge Agent (&quot;Agent&quot;) is open-source software (MIT License) that you install
              on your machines. By installing the Agent, you acknowledge that it will establish a
              persistent connection to our servers, transmit system metrics (CPU, memory, disk, hostname,
              OS), and relay terminal session input and output.
            </p>
          </Section>

          <Section title="3. Account Registration">
            <p>
              You must register for an account to access the Service. You agree to:
            </p>
            <ul>
              <li>Provide accurate, current, and complete information during registration</li>
              <li>Maintain the security of your password and accept responsibility for all activity under your account</li>
              <li>Notify us immediately at <EmailLink email={CONTACT_EMAIL} /> of any unauthorized access</li>
              <li>Not share your account credentials or API keys with unauthorized parties</li>
            </ul>
            <p>
              You must be at least 18 years old to create an account. We reserve the right to refuse
              registration or cancel accounts at our discretion.
            </p>
          </Section>

          <Section title="4. Subscription Plans and Billing">
            <h3 className="text-white font-semibold mt-6 mb-2">4.1 Plans</h3>
            <p>
              SessionForge offers the following subscription tiers:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-[#1e1e2e] rounded mt-3">
                <thead>
                  <tr className="border-b border-[#1e1e2e] bg-[#111118]">
                    <th className="text-left p-3 text-white">Plan</th>
                    <th className="text-left p-3 text-white">Price</th>
                    <th className="text-left p-3 text-white">Machines</th>
                    <th className="text-left p-3 text-white">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Free', '$0/mo', '1', '3 concurrent'],
                    ['Pro', '$19/mo', '5', 'Unlimited'],
                    ['Team', '$49/mo', '20', 'Unlimited'],
                    ['Enterprise', '$199/mo', 'Unlimited', 'Unlimited'],
                  ].map(([plan, price, machines, sessions]) => (
                    <tr key={plan} className="border-b border-[#1e1e2e]">
                      <td className="p-3">{plan}</td>
                      <td className="p-3">{price}</td>
                      <td className="p-3">{machines}</td>
                      <td className="p-3">{sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="text-white font-semibold mt-6 mb-2">4.2 Free Trial</h3>
            <p>
              New users may access Pro features free for 14 days without a credit card. After the trial,
              your account reverts to the Free plan unless you subscribe.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">4.3 Payment</h3>
            <p>
              Paid plans are billed monthly or annually in advance. Payment is processed by Stripe.
              By providing payment information, you authorize us to charge your payment method on a
              recurring basis. All fees are in USD and exclusive of applicable taxes.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">4.4 Refunds</h3>
            <p>
              Monthly subscriptions: no refunds for partial months. Annual subscriptions: no refunds
              after 14 days from the start of the billing period. If we materially degrade the
              Service, you may request a prorated refund at <EmailLink email={CONTACT_EMAIL} />.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">4.5 Plan Limits and Enforcement</h3>
            <p>
              We enforce plan limits (machine count, session count, session history duration) via
              software. Attempting to circumvent these limits is a violation of these Terms and our
              Acceptable Use Policy.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">4.6 Taxes</h3>
            <p>
              You are responsible for all applicable taxes, duties, and levies. Where required by
              law, we will collect and remit VAT/GST via Stripe Tax.
            </p>
          </Section>

          <Section title="5. User Responsibilities">
            <p>You are solely responsible for:</p>
            <ul>
              <li>All content transmitted through your sessions, including terminal I/O</li>
              <li>The machines on which you install the Agent — you must have authorization to install software on those machines</li>
              <li>Compliance with all applicable laws in your jurisdiction</li>
              <li>The security of your API keys — treat them like passwords</li>
              <li>Backing up any data you need — we do not guarantee data preservation</li>
            </ul>
            <p>
              You agree not to use the Service for any purpose prohibited by our{' '}
              <Link href="/aup" className="text-[#8B5CF6] hover:underline">Acceptable Use Policy</Link>,
              which is incorporated into these Terms by reference.
            </p>
          </Section>

          <Section title="6. Agent Software">
            <p>
              The SessionForge Agent is open-source software available under the MIT License at
              our public GitHub repository. By installing the Agent, you:
            </p>
            <ul>
              <li>Acknowledge it establishes an outbound WebSocket connection to SessionForge servers</li>
              <li>Consent to transmission of system metrics (CPU, memory, disk, hostname, OS version) every 30 seconds</li>
              <li>Consent to relay of terminal session input and output to authenticated users of your account</li>
              <li>Accept that you are installing third-party software and are responsible for its security implications</li>
            </ul>
            <p>
              We are not responsible for any damage caused by the Agent to your machines, data, or
              processes. You should review the open-source code before installation.
            </p>
          </Section>

          <Section title="7. Intellectual Property">
            <h3 className="text-white font-semibold mt-4 mb-2">7.1 Our IP</h3>
            <p>
              The SessionForge platform (excluding the open-source Agent) is proprietary software.
              All rights, title, and interest in the Service, including all software, trademarks,
              logos, and documentation, are owned by {COMPANY}.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">7.2 Your Content</h3>
            <p>
              You retain all rights to content transmitted through your sessions. We do not claim
              ownership of your terminal sessions, code, or data. You grant us a limited license
              to store and transmit your session data solely to provide the Service.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">7.3 Feedback</h3>
            <p>
              If you provide feedback or suggestions, you grant us a perpetual, irrevocable,
              royalty-free license to use that feedback without obligation to you.
            </p>
          </Section>

          <Section title="8. Data and Privacy">
            <p>
              Our collection, use, and handling of your personal data is governed by our{' '}
              <Link href="/privacy" className="text-[#8B5CF6] hover:underline">Privacy Policy</Link>,
              which is incorporated into these Terms. By using the Service, you consent to our data
              practices as described in the Privacy Policy.
            </p>
            <p>
              Session logs (terminal I/O) are retained according to your plan: 24 hours (Free),
              30 days (Pro), 90 days (Team), 1 year (Enterprise). Logs are encrypted at rest and
              in transit.
            </p>
          </Section>

          <Section title="9. Service Availability and SLA">
            <p>
              We strive for high availability but do not guarantee uninterrupted service. Planned
              maintenance will be communicated 24 hours in advance via our status page.
            </p>
            <ul>
              <li><strong className="text-white">Free:</strong> No SLA. Best effort.</li>
              <li><strong className="text-white">Pro:</strong> Best effort, no SLA.</li>
              <li><strong className="text-white">Team:</strong> 99.5% monthly uptime target.</li>
              <li><strong className="text-white">Enterprise:</strong> 99.9% monthly uptime SLA with credits.</li>
            </ul>
            <p>
              Enterprise SLA credits: for each 1% below 99.9%, you receive 10% credit on your
              monthly fee, up to 30%.
            </p>
          </Section>

          <Section title="10. Suspension and Termination">
            <h3 className="text-white font-semibold mt-4 mb-2">10.1 By You</h3>
            <p>
              You may cancel your subscription at any time via the Billing dashboard. Access
              continues until the end of your current billing period. To delete your account,
              contact <EmailLink email={CONTACT_EMAIL} />.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">10.2 By Us</h3>
            <p>
              We may suspend or terminate your account immediately if:
            </p>
            <ul>
              <li>You violate these Terms or our Acceptable Use Policy</li>
              <li>Payment fails and is not resolved within 7 days of notice</li>
              <li>We determine continued service poses a security or legal risk</li>
              <li>We cease to operate the Service</li>
            </ul>
            <p>
              We will attempt to provide 30 days&apos; notice for planned service discontinuation.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">10.3 Effect of Termination</h3>
            <p>
              Upon termination: your access ends, your data is deleted after 30 days, and you
              must uninstall all Agents from your machines. Sections 7, 11, 12, 13, and 14
              survive termination.
            </p>
          </Section>

          <Section title="11. Disclaimer of Warranties">
            <p className="uppercase text-sm">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
              EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT
              THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF VIRUSES.
            </p>
            <p className="uppercase text-sm mt-4">
              WE DO NOT WARRANT THAT ANY AI SESSIONS, OUTPUT, OR CODE TRANSMITTED THROUGH THE
              SERVICE WILL BE ACCURATE, RELIABLE, OR FIT FOR ANY PURPOSE. YOU USE AI-GENERATED
              CONTENT AT YOUR OWN RISK.
            </p>
          </Section>

          <Section title="12. Limitation of Liability">
            <p className="uppercase text-sm">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL SESSIONFORGE,
              ITS OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
              SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA,
              GOODWILL, OR BUSINESS INTERRUPTION, ARISING FROM YOUR USE OF OR INABILITY TO USE
              THE SERVICE.
            </p>
            <p className="uppercase text-sm mt-4">
              OUR TOTAL AGGREGATE LIABILITY TO YOU FOR ALL CLAIMS ARISING UNDER THESE TERMS WILL
              NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING
              THE CLAIM OR (B) $100 USD.
            </p>
            <p className="text-sm mt-4">
              Some jurisdictions do not allow the exclusion of certain warranties or limitation
              of liability, so some of the above may not apply to you.
            </p>
          </Section>

          <Section title="13. Indemnification">
            <p>
              You agree to defend, indemnify, and hold harmless {COMPANY} and its officers,
              directors, employees, and agents from and against any claims, damages, losses,
              costs, and expenses (including reasonable attorneys&apos; fees) arising from:
            </p>
            <ul>
              <li>Your use of the Service</li>
              <li>Your violation of these Terms</li>
              <li>Your violation of any applicable law or third-party rights</li>
              <li>Content or sessions transmitted through your account</li>
            </ul>
          </Section>

          <Section title="14. Governing Law and Disputes">
            <h3 className="text-white font-semibold mt-4 mb-2">14.1 Governing Law</h3>
            <p>
              These Terms are governed by the laws of the Commonwealth of {GOVERNING_STATE},
              USA, without regard to conflict of law principles.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">14.2 Informal Resolution</h3>
            <p>
              Before filing any legal claim, you agree to contact us at{' '}
              <EmailLink email={CONTACT_EMAIL} /> and attempt to resolve the dispute informally
              for at least 30 days.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">14.3 Arbitration</h3>
            <p>
              Any unresolved disputes will be settled by binding arbitration administered by JAMS
              under its Streamlined Rules. The arbitration will be conducted in {GOVERNING_STATE}.
              Class action claims are waived — all claims must be brought individually.
            </p>

            <h3 className="text-white font-semibold mt-6 mb-2">14.4 Exception</h3>
            <p>
              Either party may seek injunctive or other equitable relief in a court of competent
              jurisdiction for claims involving intellectual property or unauthorized access.
            </p>
          </Section>

          <Section title="15. Changes to Terms">
            <p>
              We may update these Terms at any time. For material changes, we will notify you by
              email at least 30 days in advance. Your continued use of the Service after changes
              take effect constitutes acceptance. If you do not agree to the changes, cancel your
              account before the effective date.
            </p>
          </Section>

          <Section title="16. General">
            <ul>
              <li><strong className="text-white">Entire Agreement:</strong> These Terms, the Privacy Policy, and the AUP constitute the entire agreement between you and SessionForge.</li>
              <li><strong className="text-white">Severability:</strong> If any provision is found unenforceable, it will be modified to the minimum extent necessary; the rest remains in effect.</li>
              <li><strong className="text-white">Waiver:</strong> Failure to enforce any provision is not a waiver of future enforcement.</li>
              <li><strong className="text-white">Assignment:</strong> You may not assign your rights without our written consent. We may assign our rights in connection with a merger or acquisition.</li>
              <li><strong className="text-white">Force Majeure:</strong> Neither party is liable for delays caused by circumstances beyond their reasonable control.</li>
              <li><strong className="text-white">No Agency:</strong> Nothing in these Terms creates a partnership, joint venture, or agency relationship.</li>
            </ul>
          </Section>

          <Section title="17. Contact">
            <p>
              For questions about these Terms, contact us at:
            </p>
            <address className="not-italic mt-3 p-4 bg-[#111118] border border-[#1e1e2e] rounded-lg text-sm">
              {COMPANY}<br />
              SessionForge<br />
              Email: <EmailLink email={CONTACT_EMAIL} /><br />
              Website: <a href={SERVICE_URL} className="text-[#8B5CF6] hover:underline">{SERVICE_URL}</a>
            </address>
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
      <div className="space-y-4">
        {children}
      </div>
    </section>
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
