/**
 * k6 performance test — POST /api/auth/callback/credentials
 *
 * Target: p95 < 200ms at 50 RPS
 *
 * NextAuth v5 credentials login endpoint.
 * We intentionally send invalid credentials so no real account is needed.
 * The server still runs the full auth middleware chain and returns 302 (redirect
 * to error page), which exercises the complete request path.
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'

const loginDuration = new Trend('login_duration', true)
const loginSuccess = new Rate('login_success_rate')

export const options = {
  scenarios: {
    constant_rps: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 60,
      maxVUs: 100,
    },
  },
  thresholds: {
    // p95 must be under 200ms per skill baseline target
    login_duration: ['p(95)<200'],
    http_req_duration: ['p(95)<200'],
  },
}

const BASE_URL = 'https://sessionforge.dev'

export default function () {
  const payload = JSON.stringify({
    email: 'perf-test@sessionforge.dev',
    password: 'WrongPassword123!',
    redirect: false,
  })

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    redirects: 0, // capture the 302 as-is, don't follow
    timeout: '10s',
  }

  const res = http.post(`${BASE_URL}/api/auth/callback/credentials`, payload, params)

  loginDuration.add(res.timings.duration)

  // NextAuth returns 302 redirect on failed credentials, or 200/401 depending on config
  const statusOk =
    res.status === 302 || res.status === 200 || res.status === 401 || res.status === 403
  loginSuccess.add(statusOk ? 1 : 0)

  check(res, {
    'auth endpoint responds': (r) =>
      r.status === 302 || r.status === 200 || r.status === 401 || r.status === 403,
    'p95 target < 200ms': (r) => r.timings.duration < 200,
  })

  sleep(0.1)
}
