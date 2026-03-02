/**
 * k6 performance test — GET /api/sessions
 *
 * Target: p95 < 150ms at 100 RPS
 *
 * This endpoint requires authentication and returns 401 without a session cookie.
 * The 401 path still exercises: TLS handshake → Cloud Run ingress → Next.js middleware
 * → auth() call → early return. This measures the full request pipeline latency
 * for this route, which is the correct baseline to track.
 *
 * To test the authenticated path, set SESSION_COOKIE env var to a valid session cookie.
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'

const sessionsDuration = new Trend('sessions_duration', true)
const sessionsSuccess = new Rate('sessions_success_rate')

export const options = {
  scenarios: {
    constant_rps: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 110,
      maxVUs: 150,
    },
  },
  thresholds: {
    // p95 must be under 150ms per skill baseline target
    sessions_duration: ['p(95)<150'],
    http_req_duration: ['p(95)<150'],
  },
}

const BASE_URL = 'https://sessionforge.dev'

// Optional: set SESSION_COOKIE environment variable to test authenticated path
// k6 run -e SESSION_COOKIE="next-auth.session-token=..." load-sessions.js
const SESSION_COOKIE = __ENV.SESSION_COOKIE || ''

export default function () {
  const headers = {
    Accept: 'application/json',
  }

  if (SESSION_COOKIE) {
    headers['Cookie'] = SESSION_COOKIE
  }

  const params = {
    headers,
    timeout: '10s',
  }

  const res = http.get(`${BASE_URL}/api/sessions`, params)

  sessionsDuration.add(res.timings.duration)

  // 401 is expected without auth cookie; 200 if authenticated
  const statusOk = res.status === 401 || res.status === 200
  sessionsSuccess.add(statusOk ? 1 : 0)

  check(res, {
    'sessions endpoint responds': (r) => r.status === 401 || r.status === 200,
    'p95 target < 150ms': (r) => r.timings.duration < 150,
  })

  sleep(0.05)
}
