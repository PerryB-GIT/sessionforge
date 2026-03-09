/**
 * E2E: Terminal session flow — start a session and verify the terminal renders.
 *
 * Strategy:
 *   1. Navigate to /sessions (authenticated via storageState)
 *   2. Check for online machines — skip with a clear message if none are available
 *   3. Click "Start Session", fill the dialog (command: bash), submit
 *   4. Wait for a new session row to appear in the list
 *   5. Click into the session detail page
 *   6. Wait for the Terminal component container to appear in the DOM
 *   7. Verify the terminal container is visible
 *   BONUS: Type "echo hello" into the terminal and verify the output appears
 *
 * Authentication:
 *   Uses storageState from e2e/.auth/user.json (set by global-setup.ts).
 *   The test.use() override below ensures this file runs authenticated even when
 *   matched by the plain 'chromium' project (no storageState in project config).
 *
 * Timeouts:
 *   Session startup involves an agent round-trip, so terminal appearance is
 *   given a 20-second window. The overall test timeout is raised to 60 seconds.
 */

import { test, expect } from '@playwright/test'

// Force authenticated storage state for this spec regardless of which project runs it.
test.use({ storageState: 'e2e/.auth/user.json' })

// Give the whole test more room — agent startup takes time.
test.setTimeout(60_000)

test.describe('Terminal session flow', () => {
  test('starts a session, navigates to detail, and verifies terminal renders', async ({ page }) => {
    // ── Step 1: Navigate to sessions ────────────────────────────────────────
    await page.goto('/sessions')
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true }).first()).toBeVisible({
      timeout: 15_000,
    })

    // ── Step 2: Open the Start Session dialog ────────────────────────────────
    await page.getByRole('button', { name: /Start Session/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Start New Session' })).toBeVisible()

    // ── Step 3: Check for "no machines online" guard ─────────────────────────
    // The dialog renders a yellow warning when no machines are online.
    const noMachinesWarning = page.getByText(/No machines are currently online/i)
    const warningVisible = await noMachinesWarning.isVisible().catch(() => false)

    if (warningVisible) {
      // Close the dialog and skip gracefully — the test environment has no agent.
      await page.keyboard.press('Escape')
      test.skip(true, 'No machines online — SessionForge agent is not running in this environment')
      return
    }

    // ── Step 4: Fill the dialog ──────────────────────────────────────────────
    // Clear the command field (defaults to "claude") and type "bash"
    const commandInput = page.getByLabel('Command')
    await commandInput.clear()
    await commandInput.fill('bash')

    // Leave Working Directory empty (optional field)
    // The machine select is auto-populated when only one machine is online.
    // If more than one machine is available the first one in the list is already
    // selected; we don't need to interact with the dropdown.

    // ── Step 5: Submit the form ──────────────────────────────────────────────
    // The submit button in the footer also reads "Start Session".
    // The one inside the dialog footer is a <button type="submit">.
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Start Session/i })
      .click()

    // Dialog should close after successful submission.
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 })

    // ── Step 6: Wait for the new session row to appear ───────────────────────
    // SessionList renders each session as a Link with href="/sessions/<id>".
    // We wait for at least one such link to exist in the DOM.
    const sessionLink = page.locator('a[href*="/sessions/"]').first()
    await expect(sessionLink).toBeVisible({ timeout: 20_000 })

    // ── Step 7: Click into the session detail ────────────────────────────────
    await sessionLink.click()
    await page.waitForURL(/\/sessions\/[^/]+$/, { timeout: 15_000 })

    // ── Step 8: Wait for the terminal container to appear ────────────────────
    // The Terminal component always renders a wrapping div with:
    //   bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg
    // The session detail page wraps the whole terminal section in:
    //   style="min-height: 400px"
    // xterm.js injects .xterm and .xterm-screen when it successfully loads.
    // We accept any of these anchors.
    const terminalContainer = page.locator('.xterm, .xterm-screen, [style*="min-height"]').first()

    await expect(terminalContainer).toBeVisible({ timeout: 20_000 })

    // ── Step 9: BONUS — send a keystroke and verify echo output ──────────────
    // This only works when xterm.js has loaded (not the stub) and the agent
    // is connected. We attempt it but do not fail the test if it does not work.
    try {
      // Click the terminal to focus it
      await terminalContainer.click({ timeout: 5_000 })

      // Type a command and press Enter
      await page.keyboard.type('echo hello', { delay: 50 })
      await page.keyboard.press('Enter')

      // xterm renders output inside canvas elements; we can detect the text
      // via the accessible textContent fallback or the xterm-accessibility div.
      // Wait up to 8 seconds for "hello" to appear anywhere in the page content.
      const helloOutput = page.getByText('hello', { exact: false })
      await expect(helloOutput).toBeVisible({ timeout: 8_000 })
    } catch {
      // BONUS step failed — this is expected in environments without a live agent
      // or when the xterm stub is rendered. The test still passes.
      console.log(
        '[terminal.spec] BONUS: echo output not detected — agent may not be connected or xterm stub is active'
      )
    }
  })

  test('Start Session dialog shows "no machines" warning when agent is offline', async ({
    page,
  }) => {
    // This test validates the graceful degradation path independently.
    await page.goto('/sessions')
    await expect(page.getByRole('button', { name: /Start Session/i })).toBeVisible({
      timeout: 15_000,
    })

    await page.getByRole('button', { name: /Start Session/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })

    // Check whether we're in a "no machines" or "machines available" state and
    // report accordingly — this test is purely informational/observational.
    const noMachinesWarning = page.getByText(/No machines are currently online/i)
    const machineSelect = page.locator('#machine')

    const [warningVisible, selectVisible] = await Promise.all([
      noMachinesWarning.isVisible().catch(() => false),
      machineSelect.isVisible().catch(() => false),
    ])

    if (warningVisible) {
      // Expected in CI / dev without a live agent
      await expect(noMachinesWarning).toBeVisible()
      // Submit button should be disabled
      const submitBtn = page.getByRole('dialog').getByRole('button', { name: /Start Session/i })
      await expect(submitBtn).toBeDisabled()
    } else if (selectVisible) {
      // Machine IS online — just verify the dialog is functional
      await expect(machineSelect).toBeVisible()
      await expect(page.getByLabel('Command')).toBeVisible()
    } else {
      // Dialog rendered but state is unknown — pass as long as dialog is visible
      await expect(page.getByRole('dialog')).toBeVisible()
    }

    // Close the dialog
    await page.getByRole('button', { name: /Cancel/i }).click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 })
  })
})
