/**
 * Visual regression tests via Percy + BrowserStack.
 * Each percySnapshot() captures the page and diffs against the baseline.
 *
 * Run locally:  npx percy exec -- npx playwright test tests/visual/
 * In CI:        PERCY_TOKEN is injected via GitHub secret
 */

import { test, expect } from '@playwright/test'
import percySnapshot from '@percy/playwright'

const BASE_URL = process.env.PERCY_TARGET_URL ?? 'https://sessionforge.dev'

test.describe('Visual regression — public pages', () => {
  test('login page', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.waitForLoadState('networkidle')
    await percySnapshot(page, 'Login Page')
  })

  test('register page', async ({ page }) => {
    await page.goto(`${BASE_URL}/register`)
    await page.waitForLoadState('networkidle')
    await percySnapshot(page, 'Register Page')
  })

  test('home / marketing page', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await percySnapshot(page, 'Home Page')
  })
})

test.describe('Visual regression — support-forge.com', () => {
  test('support-forge homepage', async ({ page }) => {
    await page.goto('https://support-forge.com')
    await page.waitForLoadState('networkidle')
    await percySnapshot(page, 'Support Forge Homepage')
  })
})
