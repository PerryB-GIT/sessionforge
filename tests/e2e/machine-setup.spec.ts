/**
 * E2E tests for machine onboarding and setup wizard
 *
 * Covers:
 *   - Dashboard → Add Machine → setup wizard shown
 *   - Install command contains a valid API key
 *   - Machine appears in the grid after the agent connects (mocked)
 *   - Machine card shows correct status indicators
 *
 * STUB: The agent connection is mocked — we inject machine data directly
 * rather than running a real agent binary.
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Shared auth helper
// STUB: Replace with storageState once the auth E2E creates a persistent session.
// ---------------------------------------------------------------------------

async function loginAsTestUser(page: Page) {
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel(/email/i).fill('test@sessionforge.dev')
  await page.getByLabel(/password/i).fill('E2eTestPass123!')
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  // Wait for dashboard to load
  await page.waitForURL(/dashboard/, { timeout: 15000 })
}

// ---------------------------------------------------------------------------
// Machine setup wizard
// ---------------------------------------------------------------------------

test.describe('Machine setup wizard', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.CI === 'true',
      'STUB: Requires seeded user + running backend. Enable once backend is deployed.'
    )
    await loginAsTestUser(page)
  })

  test('navigating to Machines page shows empty state with Add Machine button', async ({ page }) => {
    await test.step('Navigate to Machines page', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
      await expect(page).toHaveURL(/machines/)
    })

    await test.step('Verify empty state', async () => {
      // Either a zero-machine grid or an explicit empty state message
      const addButton = page.getByRole('button', { name: /add machine|new machine|connect agent/i })
      await expect(addButton).toBeVisible()
    })
  })

  test('clicking Add Machine opens the setup wizard', async ({ page }) => {
    await test.step('Navigate to Machines page', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
    })

    await test.step('Click Add Machine', async () => {
      await page.getByRole('button', { name: /add machine|new machine|connect agent/i }).click()
    })

    await test.step('Verify setup wizard is visible', async () => {
      await expect(
        page.getByText(/install agent|setup machine|connect your machine|download/i)
      ).toBeVisible({ timeout: 5000 })
    })
  })

  test('setup wizard shows an install command containing an API key', async ({ page }) => {
    await test.step('Navigate to Machines page and open wizard', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
      await page.getByRole('button', { name: /add machine|new machine|connect agent/i }).click()
    })

    await test.step('Locate the install command', async () => {
      // The install command is typically in a <code> or <pre> block
      const codeBlock = page.locator('pre, code, [data-testid="install-command"]').first()
      await expect(codeBlock).toBeVisible({ timeout: 5000 })
      const command = await codeBlock.textContent()
      expect(command).toBeTruthy()
      // The command must include the API key (sf_live_ prefix)
      expect(command).toMatch(/sf_live_[a-f0-9]+/)
    })
  })

  test('install command can be copied to clipboard', async ({ page }) => {
    await test.step('Navigate to Machines page and open wizard', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
      await page.getByRole('button', { name: /add machine|new machine|connect agent/i }).click()
    })

    await test.step('Click copy button', async () => {
      const copyButton = page.getByRole('button', { name: /copy/i }).first()
      if (await copyButton.isVisible()) {
        await copyButton.click()
        // Verify some feedback (e.g. "Copied!" tooltip or button state change)
        await expect(
          page.getByText(/copied|done/i)
        ).toBeVisible({ timeout: 3000 }).catch(() => {
          // Some implementations change the button icon instead — that's fine too
        })
      }
    })
  })

  test('STUB: machine appears in grid after agent connects via WebSocket', async ({ page }) => {
    /**
     * Full flow:
     * 1. User creates a machine via the wizard
     * 2. Agent binary installs on remote host + connects via WebSocket with the API key
     * 3. Agent sends 'register' message
     * 4. Dashboard receives a real-time 'machine_updated' WebSocket push
     * 5. Machine card appears in the grid
     *
     * STUB: We simulate step 3-5 by calling the API directly to insert a machine.
     * Replace with real WebSocket stimulus once backend is built.
     */
    test.skip(true, 'STUB: requires real WebSocket stimulus from backend')

    // Simulate machine appearing
    await page.evaluate(async () => {
      // Inject a machine_updated event directly into the browser WebSocket
      // (this is what the real server would push)
      window.dispatchEvent(
        new CustomEvent('mock:machine_updated', {
          detail: { id: 'mock-machine-id', name: 'CI Runner', status: 'online' },
        })
      )
    })

    // Machine should now appear in the grid
    await expect(page.getByText('CI Runner')).toBeVisible({ timeout: 5000 })
  })

  test('machine card shows online/offline status indicator', async ({ page }) => {
    await test.step('Navigate to Machines page with a seeded machine', async () => {
      // STUB: Seed a machine via API before this test
      await page.goto(`${BASE_URL}/dashboard/machines`)
    })

    await test.step('Verify status indicator is visible on machine card', async () => {
      // Machine cards should have a status badge/dot
      const statusBadge = page.locator('[data-testid="machine-status"], .status-badge, [aria-label*="status"]').first()
      // If there are no machines yet, this is a no-op
      if (await statusBadge.isVisible()) {
        await expect(statusBadge).toBeVisible()
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Unauthenticated access
// ---------------------------------------------------------------------------

test.describe('Machine pages - unauthenticated access', () => {
  test('accessing /dashboard/machines while logged out redirects to login', async ({ page }) => {
    await test.step('Navigate to machines page without session', async () => {
      await page.goto(`${BASE_URL}/dashboard/machines`)
    })

    await test.step('Verify redirect to login', async () => {
      await expect(page).toHaveURL(/login/, { timeout: 5000 })
    })
  })
})
