import { test, expect } from '@playwright/test'

test('Support Forge homepage loads', async ({ page }) => {
  const response = await page.goto('https://support-forge.com')
  expect(response?.status()).toBeLessThan(400)
  await expect(page).toHaveTitle(/Support Forge/)
  await page.screenshot({ path: 'support-forge-homepage.jpg' })
})
