/**
 * E2E: Marketing pages — landing page and docs
 *
 * These pages are publicly accessible (no authentication required) so all
 * tests run unconditionally.
 *
 * Covers:
 *   Landing page (/)
 *     - Loads correctly
 *     - All 4 feature cards visible by title
 *     - Pricing section visible with all 4 plan names
 *     - Nav links (Features, Pricing, Docs) are present
 *     - "Get started free" → navigates to /signup
 *     - "Sign in" link → /login
 *     - Hero CTA "Start free" → /signup
 *     - Footer links present (Privacy, Terms, Docs)
 *
 *   Docs page (/docs)
 *     - Loads with "SessionForge Docs" heading
 *     - All 6 sidebar section anchors are present
 *     - CLI reference table is present and has at least one row
 *     - Sidebar anchor links navigate in-page
 *     - "Sign in" link present in docs nav
 */

import { test, expect } from '@playwright/test'

// ─── Landing page ─────────────────────────────────────────────────────────────

test.describe('Landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('page title includes "SessionForge"', async ({ page }) => {
    await expect(page).toHaveTitle(/SessionForge/i)
  })

  test('hero heading is visible', async ({ page }) => {
    // h1 text from the landing page component
    await expect(page.getByRole('heading', { name: /Manage Claude/i })).toBeVisible()
  })

  test('nav link "Features" is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Features' })).toBeVisible()
  })

  test('nav link "Pricing" is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Pricing' })).toBeVisible()
  })

  test('nav link "Docs" points to /docs', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Docs' }).first()).toHaveAttribute('href', '/docs')
  })

  test('"Sign in" link in nav points to /login', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  test('"Get started free" nav button points to /signup', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Get started free' })).toHaveAttribute(
      'href',
      '/signup',
    )
  })

  test('hero "Start free" CTA points to /signup and navigates there on click', async ({
    page,
  }) => {
    const startFreeLink = page
      .locator('section')
      .first()
      .getByRole('link', { name: 'Start free' })
    await expect(startFreeLink).toHaveAttribute('href', '/signup')
    await startFreeLink.click()
    await expect(page).toHaveURL('/signup')
  })

  // Feature cards — titles from the `features` array in the landing page component
  test('feature card "Remote Access" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Remote Access' })).toBeVisible()
  })

  test('feature card "Multi-Machine" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Multi-Machine' })).toBeVisible()
  })

  test('feature card "Real-time Terminal" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Real-time Terminal' })).toBeVisible()
  })

  test('feature card "Instant Alerts" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Instant Alerts' })).toBeVisible()
  })

  // Pricing section
  test('pricing section heading is visible', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Simple, transparent pricing' }),
    ).toBeVisible()
  })

  test('all 4 pricing plan names are visible', async ({ page }) => {
    // Scroll to the pricing section to ensure it is in the viewport
    await page.getByRole('heading', { name: 'Simple, transparent pricing' }).scrollIntoViewIfNeeded()
    await expect(page.getByText('Free').first()).toBeVisible()
    await expect(page.getByText('Pro').first()).toBeVisible()
    await expect(page.getByText('Team').first()).toBeVisible()
    await expect(page.getByText('Enterprise').first()).toBeVisible()
  })

  test('"Most Popular" badge is visible on the Pro plan', async ({ page }) => {
    await expect(page.getByText('Most Popular')).toBeVisible()
  })

  test('pricing plan CTA "Start free" links to /signup', async ({ page }) => {
    // The Free plan has cta "Start free" and href "/signup"
    await expect(page.getByRole('link', { name: 'Start free' }).first()).toHaveAttribute(
      'href',
      '/signup',
    )
  })

  // Footer
  test('footer "Privacy" link is visible', async ({ page }) => {
    await page.getByRole('contentinfo').scrollIntoViewIfNeeded()
    await expect(page.getByRole('link', { name: 'Privacy' }).last()).toBeVisible()
  })

  test('footer "Terms" link is visible', async ({ page }) => {
    await page.getByRole('contentinfo').scrollIntoViewIfNeeded()
    await expect(page.getByRole('link', { name: 'Terms' }).last()).toBeVisible()
  })

  test('footer copyright text includes "SessionForge"', async ({ page }) => {
    await page.getByRole('contentinfo').scrollIntoViewIfNeeded()
    await expect(page.getByText(/SessionForge/i).last()).toBeVisible()
  })

  // Terminal demo block (static, always rendered)
  test('terminal demo block with "3 sessions active" label is visible', async ({ page }) => {
    await expect(page.getByText('3 sessions active')).toBeVisible()
  })
})

// ─── Docs page ────────────────────────────────────────────────────────────────

test.describe('Docs page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/docs')
  })

  test('page heading "SessionForge Docs" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'SessionForge Docs' })).toBeVisible()
  })

  // Sidebar nav items from the `navItems` array in docs/page.tsx
  test('sidebar shows "Quick Start" anchor', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Quick Start' })).toBeVisible()
  })

  test('sidebar shows "CLI Reference" anchor', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'CLI Reference' })).toBeVisible()
  })

  test('sidebar shows "Dashboard" anchor', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  })

  test('sidebar shows "API Keys" anchor', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'API Keys' })).toBeVisible()
  })

  test('sidebar shows "Supported Platforms" anchor', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Supported Platforms' })).toBeVisible()
  })

  test('sidebar shows "Supported Sessions" anchor', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Supported Sessions' })).toBeVisible()
  })

  // Section headings
  test('"Quick Start" section heading is present in main content', async ({ page }) => {
    await expect(page.locator('#quick-start')).toBeVisible()
  })

  test('"Agent CLI Reference" section heading is present', async ({ page }) => {
    await expect(page.locator('#cli-reference')).toBeVisible()
  })

  test('"API Keys" section heading is present', async ({ page }) => {
    await expect(page.locator('#api-keys')).toBeVisible()
  })

  test('"Supported Platforms" section heading is present', async ({ page }) => {
    await expect(page.locator('#platforms')).toBeVisible()
  })

  test('"Supported Sessions" section heading is present', async ({ page }) => {
    await expect(page.locator('#sessions')).toBeVisible()
  })

  // CLI reference table
  test('CLI reference table is present and has at least one command row', async ({ page }) => {
    await page.locator('#cli-reference').scrollIntoViewIfNeeded()
    const table = page.locator('#cli-reference ~ * table').first()
    await expect(table).toBeVisible()
    // The table has 14 rows from the commands array; check for at least 1 body row
    const rows = table.locator('tbody tr')
    await expect(rows.first()).toBeVisible()
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('CLI table contains "sessionforge auth login" command', async ({ page }) => {
    await page.locator('#cli-reference').scrollIntoViewIfNeeded()
    await expect(page.getByText(/sessionforge auth login/)).toBeVisible()
  })

  test('CLI table contains "sessionforge session start" command', async ({ page }) => {
    await page.locator('#cli-reference').scrollIntoViewIfNeeded()
    await expect(page.getByText(/sessionforge session start/)).toBeVisible()
  })

  // Supported Platforms table
  test('Supported Platforms table lists Linux, macOS, and Windows', async ({ page }) => {
    await page.locator('#platforms').scrollIntoViewIfNeeded()
    await expect(page.getByText('Linux').first()).toBeVisible()
    await expect(page.getByText('macOS').first()).toBeVisible()
    await expect(page.getByText('Windows').first()).toBeVisible()
  })

  // Quick Start install command snippets
  test('Linux/macOS install command snippet is visible', async ({ page }) => {
    await expect(page.getByText(/curl -fsSL https:\/\/sessionforge\.dev\/agent/)).toBeVisible()
  })

  test('Windows install command snippet is visible', async ({ page }) => {
    await expect(page.getByText(/iwr -useb.*install\.ps1/)).toBeVisible()
  })

  // sf_live_ key format example
  test('key format example "sf_live_" is visible in API Keys section', async ({ page }) => {
    await page.locator('#api-keys').scrollIntoViewIfNeeded()
    await expect(page.getByText(/sf_live_/)).toBeVisible()
  })

  // Sidebar anchor link navigates in-page
  test('clicking "CLI Reference" sidebar link scrolls to that section', async ({ page }) => {
    await page.getByRole('link', { name: 'CLI Reference' }).click()
    // After anchor navigation the URL fragment should update
    await expect(page).toHaveURL(/\#cli-reference/)
  })

  // Nav bar on docs page
  test('docs nav "Sign in" link is visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  })

  test('docs nav "SessionForge" logo link points to /', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'SessionForge' }).first()).toHaveAttribute(
      'href',
      '/',
    )
  })
})
