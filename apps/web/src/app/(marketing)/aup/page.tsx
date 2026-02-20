export const metadata = {
  title: 'Acceptable Use Policy — SessionForge',
  description: 'Acceptable Use Policy for SessionForge.',
}

const EFFECTIVE_DATE = 'February 18, 2026'

export default function AupPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">Acceptable Use Policy</h1>
        <p className="text-sm text-gray-500">Effective date: {EFFECTIVE_DATE}</p>
      </div>

      <div className="space-y-8 text-gray-300 text-sm leading-relaxed">

        <p>
          This Acceptable Use Policy ("AUP") sets out the rules for using SessionForge ("Service"),
          operated by SessionForge Inc. This AUP is incorporated into and forms part of our{' '}
          <a href="/terms" className="text-purple-400 hover:text-purple-300 transition-colors">
            Terms of Service
          </a>
          . Violations of this AUP may result in immediate suspension or termination of your account.
        </p>

        <Section title="1. Prohibited Activities">
          <p>You must not use the Service to:</p>

          <SubSection title="Security & System Integrity">
            <ul className="space-y-2 list-disc list-inside text-gray-400">
              <li>Launch attacks on any system, network, or infrastructure (DDoS, port scanning, fuzzing)</li>
              <li>Exploit or attempt to exploit vulnerabilities in SessionForge or third-party systems</li>
              <li>Intercept network traffic without authorization (man-in-the-middle attacks)</li>
              <li>Deploy or distribute malware, ransomware, spyware, or any malicious code</li>
              <li>Conduct unauthorized penetration testing of systems you do not own</li>
              <li>Attempt to access accounts, data, or systems you are not authorized to access</li>
            </ul>
          </SubSection>

          <SubSection title="Abuse & Spam">
            <ul className="space-y-2 list-disc list-inside text-gray-400">
              <li>Send unsolicited bulk messages (spam) or conduct phishing campaigns</li>
              <li>Harvest or scrape email addresses, usernames, or personal data at scale</li>
              <li>Create fake accounts or impersonate individuals, organizations, or SessionForge</li>
              <li>Artificially inflate usage metrics or circumvent account-level limits</li>
            </ul>
          </SubSection>

          <SubSection title="Illegal & Harmful Content">
            <ul className="space-y-2 list-disc list-inside text-gray-400">
              <li>Store, transmit, or process child sexual abuse material (CSAM) or any content that exploits minors</li>
              <li>Violate intellectual property rights, including copyright, trademark, or trade secret laws</li>
              <li>Facilitate fraud, money laundering, or any other financial crime</li>
              <li>Engage in activities that violate applicable export control or sanctions laws</li>
              <li>Host or distribute content that incites violence or constitutes hate speech</li>
            </ul>
          </SubSection>

          <SubSection title="Service Integrity">
            <ul className="space-y-2 list-disc list-inside text-gray-400">
              <li>Reverse-engineer, decompile, or derive source code from the Service</li>
              <li>Circumvent authentication, rate limiting, or any security control</li>
              <li>Use the Service to mine cryptocurrency or perform resource-intensive workloads unrelated to legitimate development</li>
              <li>Resell access to the Service without a written reseller agreement</li>
            </ul>
          </SubSection>
        </Section>

        <Section title="2. Responsible Security Research">
          <p>
            We support legitimate security research. If you believe you have found a vulnerability
            in SessionForge, please disclose it responsibly to{' '}
            <a href="mailto:security@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              security@sessionforge.dev
            </a>{' '}
            before any public disclosure. Testing must be limited to accounts and data you own. Do not
            impact availability for other users, and do not exfiltrate data beyond what is needed to
            demonstrate the issue. We will acknowledge your report within 72 hours.
          </p>
        </Section>

        <Section title="3. Resource Usage">
          <p>
            You agree to use the Service within the limits of your plan. Excessive resource
            consumption that degrades performance for other users may result in throttling or
            suspension. Contact us at{' '}
            <a href="mailto:support@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              support@sessionforge.dev
            </a>{' '}
            if you anticipate unusually high usage (e.g. load testing) so we can accommodate your
            needs without impacting other customers.
          </p>
        </Section>

        <Section title="4. Reporting Violations">
          <p>
            If you become aware of any violation of this AUP, please report it to{' '}
            <a href="mailto:abuse@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              abuse@sessionforge.dev
            </a>
            . We will investigate all reports promptly and take appropriate action, which may include
            suspending the offending account and notifying law enforcement where required.
          </p>
        </Section>

        <Section title="5. Enforcement">
          <p>
            We reserve the right to investigate suspected violations and to remove content or suspend
            accounts without prior notice when necessary to protect the Service, our users, or third
            parties. We will cooperate with law enforcement agencies in investigations of illegal
            activity. Decisions about enforcement are made at our sole discretion.
          </p>
        </Section>

        <Section title="6. Changes to This Policy">
          <p>
            We may update this AUP from time to time. Material changes will be communicated by
            email or in-app notice at least 14 days before taking effect. Continued use of the
            Service constitutes acceptance.
          </p>
        </Section>

        <Section title="7. Contact">
          <p>
            Questions about this policy? Email{' '}
            <a href="mailto:legal@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              legal@sessionforge.dev
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
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-200 mb-2">{title}</h3>
      {children}
    </div>
  )
}
