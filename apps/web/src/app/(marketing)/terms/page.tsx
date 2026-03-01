export const metadata = {
  title: 'Terms of Service — SessionForge',
  description: 'Terms of Service for SessionForge.',
}

const EFFECTIVE_DATE = 'February 18, 2026'

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white mb-3">Terms of Service</h1>
        <p className="text-sm text-gray-500">Effective date: {EFFECTIVE_DATE}</p>
      </div>

      <div className="space-y-8 text-gray-300 text-sm leading-relaxed">

        <p>
          These Terms of Service ("Terms") govern your access to and use of SessionForge ("Service"),
          operated by SessionForge Inc. ("we", "us", or "our"). By creating an account or using the
          Service you agree to be bound by these Terms. If you do not agree, do not use the Service.
        </p>

        <Section title="1. Eligibility">
          <p>
            You must be at least 16 years old to use SessionForge. By using the Service you represent
            that you meet this requirement and that you have the legal capacity to enter into a binding
            agreement. If you are using the Service on behalf of a company or organization, you
            represent that you have authority to bind that entity to these Terms.
          </p>
        </Section>

        <Section title="2. Account Registration">
          <p>
            You must provide accurate and complete information when creating an account. You are
            responsible for maintaining the confidentiality of your credentials and for all activity
            that occurs under your account. Notify us immediately at{' '}
            <a href="mailto:security@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              security@sessionforge.dev
            </a>{' '}
            if you suspect unauthorized access. We reserve the right to terminate accounts containing
            false information or that violate these Terms.
          </p>
        </Section>

        <Section title="3. Acceptable Use">
          <p>
            You agree to use the Service only for lawful purposes and in accordance with our{' '}
            <a href="/aup" className="text-purple-400 hover:text-purple-300 transition-colors">
              Acceptable Use Policy
            </a>
            . You must not:
          </p>
          <ul className="mt-3 space-y-2 list-disc list-inside text-gray-400">
            <li>Use the Service to transmit malware, spam, or any harmful code</li>
            <li>Attempt to gain unauthorized access to any system, network, or account</li>
            <li>Reverse-engineer, decompile, or disassemble any part of the Service</li>
            <li>Resell or sublicense the Service without our written consent</li>
            <li>Interfere with or disrupt the integrity or performance of the Service</li>
            <li>Use the Service in any way that violates applicable law or regulation</li>
          </ul>
        </Section>

        <Section title="4. Plans, Billing, and Cancellation">
          <p>
            The Service is offered on a subscription basis. Paid plans are billed in advance on a
            monthly or annual cycle. All fees are non-refundable except where required by law. You may
            cancel your subscription at any time; access continues until the end of the current billing
            period. We may change pricing with 30 days' notice. Continued use after a price change
            constitutes acceptance of the new pricing.
          </p>
        </Section>

        <Section title="5. Your Content">
          <p>
            You retain ownership of all data, code, and content you submit to the Service ("Your
            Content"). By using the Service you grant us a limited, non-exclusive license to store and
            process Your Content solely to provide the Service to you. We will not use Your Content for
            any other purpose or sell it to third parties. You are solely responsible for the legality,
            accuracy, and appropriateness of Your Content.
          </p>
        </Section>

        <Section title="6. Intellectual Property">
          <p>
            The Service, including its software, design, text, and graphics, is owned by SessionForge
            and protected by copyright and other intellectual property laws. Nothing in these Terms
            transfers any intellectual property to you. You may not use our trademarks or branding
            without prior written permission.
          </p>
        </Section>

        <Section title="7. Availability">
          <p>
            We aim for high availability but do not guarantee uninterrupted access. We may suspend the
            Service for maintenance with reasonable notice where practicable. We are not liable for
            losses arising from downtime or service interruptions beyond the amounts paid by you in
            the prior three months.
          </p>
        </Section>

        <Section title="8. Disclaimer of Warranties">
          <p className="uppercase text-xs tracking-wide text-gray-400">
            The Service is provided "as is" and "as available" without warranties of any kind, express
            or implied, including merchantability, fitness for a particular purpose, or
            non-infringement. We do not warrant that the Service will be error-free.
          </p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p className="uppercase text-xs tracking-wide text-gray-400">
            To the maximum extent permitted by law, SessionForge shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages, or loss of profits or revenue,
            arising out of or in connection with your use of the Service, even if advised of the
            possibility of such damages.
          </p>
        </Section>

        <Section title="10. Indemnification">
          <p>
            You agree to indemnify and hold harmless SessionForge and its officers, directors,
            employees, and agents from any claims, damages, or expenses (including reasonable legal
            fees) arising from your use of the Service, Your Content, or your violation of these Terms.
          </p>
        </Section>

        <Section title="11. Termination">
          <p>
            We may suspend or terminate your access at any time for violation of these Terms. You may
            terminate your account by contacting{' '}
            <a href="mailto:support@sessionforge.dev" className="text-purple-400 hover:text-purple-300 transition-colors">
              support@sessionforge.dev
            </a>
            . Upon termination, your right to use the Service immediately ceases.
          </p>
        </Section>

        <Section title="12. Governing Law">
          <p>
            These Terms are governed by the laws of the State of Delaware, without regard to conflict
            of law principles. Disputes shall be resolved in the state or federal courts located in
            Delaware.
          </p>
        </Section>

        <Section title="13. Changes to These Terms">
          <p>
            We may revise these Terms from time to time. We will notify you of material changes by
            email or in-app notice at least 14 days before they take effect. Continued use of the
            Service after the effective date constitutes acceptance of the revised Terms.
          </p>
        </Section>

        <Section title="14. Contact">
          <p>
            Questions about these Terms? Email{' '}
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
      <div className="space-y-3">{children}</div>
    </section>
  )
}
