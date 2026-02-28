import { test, expect } from '@playwright/test'

test('SessionForge homepage loads', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBeLessThan(400)
  await expect(page).toHaveTitle(/SessionForge/)
  await expect(page.getByRole('link', { name: /get started|sign up/i })).toBeVisible()
  await page.screenshot({ path: 'sessionforge-homepage.jpg' })
})

test('Login page is accessible', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel(/email/i)).toBeVisible()
  await expect(page.getByLabel(/password/i)).toBeVisible()
})
