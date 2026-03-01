import crypto from 'crypto'
import { eq, and } from 'drizzle-orm'
import { db, webhooks, webhookDeliveries } from '@/db'

export type WebhookEvent =
  | 'session.started'
  | 'session.stopped'
  | 'session.crashed'
  | 'machine.online'
  | 'machine.offline'

export async function signWebhookPayload(secret: string, body: string): Promise<string> {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body)
  return `sha256=${hmac.digest('hex')}`
}

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function deliverWebhook(
  event: WebhookEvent,
  payload: Record<string, unknown>,
  userId: string
): Promise<void> {
  // Find all enabled webhooks for this user that subscribe to this event
  const targets = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.userId, userId), eq(webhooks.enabled, true)))

  const subscribedTargets = targets.filter(
    (w) => (w.events as string[]).includes(event) || (w.events as string[]).includes('*')
  )

  if (subscribedTargets.length === 0) return

  const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() })

  await Promise.allSettled(
    subscribedTargets.map((webhook) => attemptDelivery(webhook, event, body, payload))
  )
}

async function attemptDelivery(
  webhook: typeof webhooks.$inferSelect,
  event: WebhookEvent,
  body: string,
  payload: Record<string, unknown>
): Promise<void> {
  const signature = await signWebhookPayload(webhook.secret, body)

  // Create delivery record
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      webhookId: webhook.id,
      event,
      payload: payload as Record<string, unknown>,
      status: 'pending',
      attempts: 0,
    })
    .returning()

  await sendWithRetry(webhook.url, body, signature, delivery.id, 1)
}

async function sendWithRetry(
  url: string,
  body: string,
  signature: string,
  deliveryId: string,
  attempt: number
): Promise<void> {
  const MAX_ATTEMPTS = 3
  const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] // 1min, 5min, 30min

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SessionForge-Signature': signature,
        'X-SessionForge-Event': 'webhook',
        'User-Agent': 'SessionForge-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    const responseBody = await res.text().catch(() => '')

    await db
      .update(webhookDeliveries)
      .set({
        status: res.ok ? 'delivered' : 'failed',
        responseCode: res.status,
        responseBody: responseBody.slice(0, 1000),
        attempts: attempt,
        lastAttemptAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId))

    if (!res.ok && attempt < MAX_ATTEMPTS) {
      setTimeout(
        () => sendWithRetry(url, body, signature, deliveryId, attempt + 1),
        RETRY_DELAYS_MS[attempt - 1]
      )
    }
  } catch {
    await db
      .update(webhookDeliveries)
      .set({
        status: attempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts: attempt,
        lastAttemptAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId))

    if (attempt < MAX_ATTEMPTS) {
      setTimeout(
        () => sendWithRetry(url, body, signature, deliveryId, attempt + 1),
        RETRY_DELAYS_MS[attempt - 1]
      )
    }
  }
}
