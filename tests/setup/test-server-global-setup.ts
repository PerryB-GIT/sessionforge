/**
 * Vitest globalSetup — starts the Next.js dev server on port 3001 before the
 * integration test suite runs, then tears it down afterwards.
 *
 * The BASE_URL env var is set to http://localhost:3001 so every test file can
 * do:  const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3001'
 *
 * Why next dev rather than next start?
 *   next start requires a prior `next build` which is slow in CI.
 *   next dev works out of the box from the source tree and respects the same
 *   env vars, making it suitable for integration tests against real route
 *   handlers.
 *
 * Ports:
 *   3001 — Next.js HTTP (integration tests hit this via fetch)
 *
 * Environment variables consumed by the route handlers are set in
 * tests/setup/vitest.setup.ts; the child process inherits process.env so
 * those values flow into the Next.js server automatically.
 */

import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

const TEST_PORT = 3001
export const TEST_BASE_URL = `http://localhost:${TEST_PORT}`

// Absolute path to the Next.js app
const WEB_APP_DIR = path.resolve(__dirname, '../../../../apps/web')

let serverProcess: ChildProcess | null = null

/** Poll until the /api/health endpoint returns 200, or throw after timeout. */
async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return
    } catch {
      // Server not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`[test-server] Timed out waiting for Next.js server at ${url}`)
}

export async function setup(): Promise<void> {
  // If the server is already running (e.g., in watch mode), skip starting it
  try {
    const res = await fetch(`${TEST_BASE_URL}/api/health`)
    if (res.ok) {
      console.log(`[test-server] Server already running at ${TEST_BASE_URL}`)
      process.env.TEST_BASE_URL = TEST_BASE_URL
      return
    }
  } catch {
    // Not running — fall through to spawn
  }

  console.log(`[test-server] Starting Next.js dev server on port ${TEST_PORT}…`)
  console.log(`[test-server] Working directory: ${WEB_APP_DIR}`)

  // Inherit env so vitest.setup.ts env vars (mocks, secrets) reach the server
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(TEST_PORT),
    NODE_ENV: 'test',
    // Disable telemetry noise
    NEXT_TELEMETRY_DISABLED: '1',
  }

  serverProcess = spawn('npx', ['next', 'dev', '--port', String(TEST_PORT)], {
    cwd: WEB_APP_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim()
    if (line) process.stdout.write(`[next-dev] ${line}\n`)
  })

  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim()
    if (line) process.stderr.write(`[next-dev] ${line}\n`)
  })

  serverProcess.on('error', (err) => {
    console.error('[test-server] Failed to start Next.js process:', err)
  })

  process.env.TEST_BASE_URL = TEST_BASE_URL

  await waitForServer(TEST_BASE_URL, 90_000)
  console.log(`[test-server] Next.js server is ready at ${TEST_BASE_URL}`)
}

export async function teardown(): Promise<void> {
  if (serverProcess) {
    console.log('[test-server] Stopping Next.js dev server…')
    serverProcess.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      serverProcess!.once('exit', () => resolve())
      // Force-kill after 10s if it doesn't exit cleanly
      setTimeout(() => {
        serverProcess?.kill('SIGKILL')
        resolve()
      }, 10_000)
    })
    serverProcess = null
    console.log('[test-server] Server stopped.')
  }
}
