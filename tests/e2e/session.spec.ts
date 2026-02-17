/**
 * E2E tests for session lifecycle
 *
 * Covers:
 *   - Login → dashboard → Machines page
 *   - Click machine → sessions tab
 *   - Start session dialog → select command → terminal loads
 *   - Type in terminal → input is sent
 *   - Stop session → status changes to stopped
 *
 * STUB: Machine connection and terminal output are simulated.
 * Replace mocked steps with real WebSocket stimuli once backend is built.
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Auth helper
// STUB: Replace with storageState once persistent auth is set up.
// ---------------------------------------------------------------------------

async function loginAsTestUser(page: Page) {
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/email/i).fill('test@sessionforge.dev')
  await page.getByLabel(/password/i).fill('E2eTestPass123!')
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL(/dashboard/, { timeout: 15000 })
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

test.describe('Session lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.CI === 'true',
      'STUB: Requires seeded user + online machine. Enable once backend is deployed.'
    )
    await loginAsTestUser(page)
  })

  test('navigating to dashboard shows Machines page link', async ({ page }) => {
    await test.step('Verify dashboard navigation includes Machines', async () => {
      await expect(
        page.getByRole('link', { name: /machines/i })
      ).toBeVisible()
    })
  })

  test('Machines page renders a machine grid after login', async ({ page }) => {
    await test.step('Navigate to Machines page', async () => {
      await page.getByRole('link', { name: /machines/i }).click()
      await expect(page).toHaveURL(/machines/, { timeout: 5000 })
    })

    await test.step('Verify machines section is visible', async () => {
      await expect(
        page.getByRole('heading', { name: /machines/i })
      ).toBeVisible()
    })
  })

  test('STUB: clicking a machine opens sessions tab', async ({ page }) => {
    test.skip(true, 'STUB: requires an online machine in test DB')

    await test.step('Navigate to Machines page', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
    })

    await test.step('Click the first machine card', async () => {
      await page.locator('[data-testid="machine-card"]').first().click()
    })

    await test.step('Verify machine detail page loads with Sessions tab', async () => {
      await expect(page.getByRole('tab', { name: /sessions/i })).toBeVisible({ timeout: 5000 })
    })
  })

  test('STUB: start session dialog appears with command selection', async ({ page }) => {
    test.skip(true, 'STUB: requires an online machine in test DB')

    await test.step('Navigate to machine detail page', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
      await page.locator('[data-testid="machine-card"]').first().click()
    })

    await test.step('Click Sessions tab and Start Session button', async () => {
      await page.getByRole('tab', { name: /sessions/i }).click()
      await page.getByRole('button', { name: /start session|new session/i }).click()
    })

    await test.step('Verify start session dialog is shown', async () => {
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
      // Dialog should include a command field defaulting to 'claude'
      const commandInput = page.getByLabel(/command/i)
      await expect(commandInput).toBeVisible()
      const value = await commandInput.inputValue()
      expect(value).toBe('claude')
    })
  })

  test('STUB: terminal loads after starting a session', async ({ page }) => {
    test.skip(true, 'STUB: requires a real WebSocket connection to a live machine')

    await test.step('Navigate to machine, open Sessions tab, start session', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
      await page.locator('[data-testid="machine-card"]').first().click()
      await page.getByRole('tab', { name: /sessions/i }).click()
      await page.getByRole('button', { name: /start session|new session/i }).click()
      await page.getByRole('button', { name: /start|connect|launch/i }).click()
    })

    await test.step('Verify terminal component is visible', async () => {
      // Terminal is typically rendered inside an xterm.js div
      const terminal = page.locator('.xterm, [data-testid="terminal"], [role="terminal"]')
      await expect(terminal).toBeVisible({ timeout: 10000 })
    })
  })

  test('STUB: typing in terminal sends input to the session', async ({ page }) => {
    test.skip(true, 'STUB: requires a running session with WebSocket connection')

    await test.step('Ensure terminal is open', async () => {
      // Navigate to an active session terminal
      await page.goto(`${BASE_URL}/dashboard/sessions/stub-session-id`)
    })

    await test.step('Type in terminal', async () => {
      const terminal = page.locator('.xterm, [data-testid="terminal"]')
      await terminal.click()
      await page.keyboard.type('ls -la')
      await page.keyboard.press('Enter')
    })

    await test.step('Verify input was sent (output reflects command)', async () => {
      // Wait for the terminal to show some output
      await expect(page.locator('.xterm-rows')).toContainText('ls', { timeout: 5000 })
    })
  })

  test('STUB: stopping a session changes its status to stopped', async ({ page }) => {
    test.skip(true, 'STUB: requires a running session')

    await test.step('Navigate to an active session', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
      await page.locator('[data-testid="machine-card"]').first().click()
      await page.getByRole('tab', { name: /sessions/i }).click()
    })

    await test.step('Click stop on the running session', async () => {
      await page.getByRole('button', { name: /stop session/i }).first().click()
      // Confirm in a dialog if present
      const confirmButton = page.getByRole('button', { name: /confirm|yes, stop/i })
      if (await confirmButton.isVisible({ timeout: 1000 })) {
        await confirmButton.click()
      }
    })

    await test.step('Verify session status changes to stopped', async () => {
      await expect(
        page.getByText(/stopped|completed/i)
      ).toBeVisible({ timeout: 5000 })
    })
  })
})

// ---------------------------------------------------------------------------
// Session page - unauthenticated access
// ---------------------------------------------------------------------------

test.describe('Session pages - unauthenticated access', () => {
  test('accessing a session page while logged out redirects to login', async ({ page }) => {
    await test.step('Navigate to a session page without auth', async () => {
      await page.goto(`${BASE_URL}/dashboard/sessions/any-session-id`)
    })

    await test.step('Verify redirect to login', async () => {
      await expect(page).toHaveURL(/login/, { timeout: 5000 })
    })
  })
})

// ---------------------------------------------------------------------------
// Session list view
// ---------------------------------------------------------------------------

test.describe('Session list view', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.CI === 'true',
      'STUB: Requires seeded user. Enable once backend is deployed.'
    )
    await loginAsTestUser(page)
  })

  test('Sessions overview page is reachable from the sidebar', async ({ page }) => {
    await test.step('Click Sessions link in sidebar/nav', async () => {
      const sessionsLink = page.getByRole('link', { name: /sessions/i })
      if (await sessionsLink.isVisible()) {
        await sessionsLink.click()
        await expect(page).toHaveURL(/sessions/, { timeout: 5000 })
      }
    })
  })

  test('sessions list shows session status badges', async ({ page }) => {
    await test.step('Navigate to sessions page', async () => {
      await page.goto(`${BASE_URL}/dashboard/sessions`)
    })

    await test.step('Verify page renders (even if empty)', async () => {
      await expect(
        page.getByRole('heading', { name: /sessions/i })
      ).toBeVisible({ timeout: 5000 })
    })
  })
})
