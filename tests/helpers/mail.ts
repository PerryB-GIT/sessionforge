/**
 * Mailosaur email test helpers
 *
 * Provides utilities for waiting on real emails delivered to a Mailosaur
 * inbox during integration tests.  Requires the following environment
 * variables to be set:
 *
 *   MAILOSAUR_API_KEY    — your Mailosaur API key
 *   MAILOSAUR_SERVER_ID  — the Mailosaur server / inbox ID (e.g. "p5rngoh5")
 *
 * Usage:
 *
 *   const address = makeMailosaurAddress('password-reset')
 *   // trigger your app to send an email to `address`
 *   const email = await waitForEmail(address, 'Reset your password')
 *   const link = extractResetLink(email)
 */

import MailosaurClient, { Message, Link } from 'mailosaur'

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let _client: MailosaurClient | null = null

function getClient(): MailosaurClient {
  if (!_client) {
    const apiKey = process.env.MAILOSAUR_API_KEY
    if (!apiKey) throw new Error('[mail] MAILOSAUR_API_KEY is not set')
    _client = new MailosaurClient(apiKey)
  }
  return _client
}

function getServerId(): string {
  const serverId = process.env.MAILOSAUR_SERVER_ID
  if (!serverId) throw new Error('[mail] MAILOSAUR_SERVER_ID is not set')
  return serverId
}

// ---------------------------------------------------------------------------
// Address factory
// ---------------------------------------------------------------------------

/**
 * Generate a valid Mailosaur inbox address.
 *
 * @param prefix - Optional prefix to make the address identifiable in logs.
 *                 Defaults to a random UUID segment.
 *
 * @example
 *   makeMailosaurAddress('signup')
 *   // → 'signup-a3f2@p5rngoh5.mailosaur.net'
 */
export function makeMailosaurAddress(prefix?: string): string {
  const serverId = getServerId()
  const tag = prefix
    ? `${prefix}-${Math.random().toString(36).slice(2, 6)}`
    : Math.random().toString(36).slice(2, 10)
  return `${tag}@${serverId}.mailosaur.net`
}

// ---------------------------------------------------------------------------
// Wait for email
// ---------------------------------------------------------------------------

/**
 * Wait for an email to arrive in the Mailosaur inbox.
 *
 * Uses the Mailosaur `messages.get` long-poll API which is more efficient
 * than polling `messages.list`.  The call resolves as soon as a matching
 * message arrives, or rejects after `timeoutMs`.
 *
 * @param toAddress  - The full Mailosaur address the email was sent to.
 * @param subject    - Optional subject substring to narrow the search.
 * @param timeoutMs  - How long to wait before giving up (default 30 s).
 */
export async function waitForEmail(
  toAddress: string,
  subject?: string,
  timeoutMs = 30_000
): Promise<Message> {
  const client = getClient()
  const serverId = getServerId()

  const searchCriteria: Record<string, string> = { sentTo: toAddress }
  if (subject) searchCriteria['subject'] = subject

  try {
    const message = await client.messages.get(
      serverId,
      searchCriteria,
      { timeout: timeoutMs, receivedAfter: new Date(Date.now() - 60_000) }
    )
    return message
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `[mail] Timed out waiting for email to <${toAddress}>${subject ? ` with subject "${subject}"` : ''} after ${timeoutMs}ms. Mailosaur error: ${detail}`
    )
  }
}

// ---------------------------------------------------------------------------
// Link extractors
// ---------------------------------------------------------------------------

/**
 * Pull the first href from an email body that looks like a magic-link /
 * email-verification URL.
 *
 * Looks for links containing common verification path segments:
 *   /verify, /confirm, /activate, /magic-link, /auth
 *
 * @throws if no matching link is found in the email.
 */
export function extractMagicLink(email: Message): string {
  const links = email.html?.links ?? email.text?.links ?? []

  const MAGIC_LINK_PATTERN = /\/(verify|confirm|activate|magic-link|auth)/i

  const link = links.find((l: Link) => l.href && MAGIC_LINK_PATTERN.test(l.href))
  if (!link?.href) {
    throw new Error(
      `[mail] No magic/verify link found in email "${email.subject ?? '(no subject)'}". ` +
      `Available hrefs: ${links.map((l: Link) => l.href).filter(Boolean).join(', ') || '(none)'}`
    )
  }
  return link.href
}

/**
 * Pull the first href from an email body that looks like a password-reset URL.
 *
 * Looks for links containing common reset path segments:
 *   /reset, /forgot, /set-password, /new-password
 *
 * @throws if no matching link is found in the email.
 */
export function extractResetLink(email: Message): string {
  const links = email.html?.links ?? email.text?.links ?? []

  const RESET_LINK_PATTERN = /\/(reset|forgot|set-password|new-password)/i

  const link = links.find((l: Link) => l.href && RESET_LINK_PATTERN.test(l.href))
  if (!link?.href) {
    throw new Error(
      `[mail] No password-reset link found in email "${email.subject ?? '(no subject)'}". ` +
      `Available hrefs: ${links.map((l: Link) => l.href).filter(Boolean).join(', ') || '(none)'}`
    )
  }
  return link.href
}

// ---------------------------------------------------------------------------
// Inbox management
// ---------------------------------------------------------------------------

/**
 * Delete all messages from the Mailosaur server inbox.
 * Call this in a beforeEach or afterEach to keep tests independent.
 */
export async function clearInbox(): Promise<void> {
  const client = getClient()
  const serverId = getServerId()
  await client.messages.deleteAll(serverId)
}
