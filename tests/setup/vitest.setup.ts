/**
 * Vitest global setup file
 * Runs before every test file in the unit and integration suites.
 */
import { vi, beforeAll, afterAll, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test'
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/sessionforge_test'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.NEXTAUTH_SECRET = 'test-secret-do-not-use-in-production'
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.STRIPE_SECRET_KEY = 'sk_test_vitest_mock'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_vitest_mock'
process.env.RESEND_API_KEY = 're_test_vitest_mock'
process.env.UPSTASH_REDIS_REST_URL = 'http://localhost:8079'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token'

// ---------------------------------------------------------------------------
// Mock Stripe
// ---------------------------------------------------------------------------
vi.mock('stripe', () => {
  const StripeInstance = {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_test123', email: 'test@sessionforge.dev' }),
      retrieve: vi.fn().mockResolvedValue({ id: 'cus_test123', email: 'test@sessionforge.dev' }),
    },
    subscriptions: {
      create: vi.fn().mockResolvedValue({ id: 'sub_test123', status: 'active' }),
      update: vi.fn().mockResolvedValue({ id: 'sub_test123', status: 'active' }),
      cancel: vi.fn().mockResolvedValue({ id: 'sub_test123', status: 'canceled' }),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test123',
          url: 'https://checkout.stripe.com/test/cs_test123',
        }),
      },
    },
    webhooks: {
      constructEvent: vi.fn().mockReturnValue({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test123' } },
      }),
    },
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test/bps_test123' }),
      },
    },
  }
  return {
    default: vi.fn(() => StripeInstance),
    Stripe: vi.fn(() => StripeInstance),
  }
})

// ---------------------------------------------------------------------------
// Mock Resend (email)
// ---------------------------------------------------------------------------
vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: vi.fn().mockResolvedValue({ id: 'email_test123', error: null }),
      },
    })),
  }
})

// ---------------------------------------------------------------------------
// Mock Upstash Redis
// ---------------------------------------------------------------------------
vi.mock('@upstash/redis', () => {
  const store = new Map<string, unknown>()
  const subscribers = new Map<string, Array<(message: string) => void>>()

  return {
    Redis: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((key: string, value: unknown) => {
        store.set(key, value)
        return Promise.resolve('OK')
      }),
      get: vi.fn().mockImplementation((key: string) => {
        return Promise.resolve(store.get(key) ?? null)
      }),
      del: vi.fn().mockImplementation((key: string) => {
        store.delete(key)
        return Promise.resolve(1)
      }),
      publish: vi.fn().mockImplementation((channel: string, message: string) => {
        const subs = subscribers.get(channel) ?? []
        subs.forEach((fn) => fn(message))
        return Promise.resolve(subs.length)
      }),
      subscribe: vi.fn().mockImplementation((channel: string, fn: (message: string) => void) => {
        if (!subscribers.has(channel)) subscribers.set(channel, [])
        subscribers.get(channel)!.push(fn)
        return Promise.resolve()
      }),
    })),
  }
})

// ---------------------------------------------------------------------------
// Global lifecycle hooks
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Any global setup that runs once before all tests in this suite
  // The actual DB connection is handled per-suite in tests/helpers/db.ts
})

afterEach(() => {
  // Clear all mock call history between tests so tests don't bleed into each other
  vi.clearAllMocks()
})

afterAll(async () => {
  // Any global teardown that runs once after all tests in this suite
  vi.restoreAllMocks()
})
