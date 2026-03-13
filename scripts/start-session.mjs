#!/usr/bin/env node
// start-session.mjs
// Uses Playwright to log into sessionforge.dev and start a new session.
// Outputs: SESSION_ID=<uuid> on success, exits non-zero on failure.
// Reuses existing browser state (cookies) if available.

import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATE_FILE = join(homedir(), '.sessionforge', 'playwright-state.json');
const BASE_URL = 'https://sessionforge.dev';
const MACHINE_NAME = 'DESKTOP-2L1SN9D-test';

// Credentials for login if session is expired
const EMAIL = 'perry.bailes@gmail.com';

async function run() {
  const browser = await chromium.launch({ headless: true });

  const contextOptions = {};
  if (existsSync(STATE_FILE)) {
    contextOptions.storageState = STATE_FILE;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    // Navigate to sessions page
    await page.goto(`${BASE_URL}/sessions`, { waitUntil: 'networkidle', timeout: 15000 });

    // Check if we landed on login page
    if (page.url().includes('/login')) {
      process.stderr.write('[start-session] Not logged in. Need to authenticate.\n');
      process.exit(2);
    }

    // Wait for the page to load
    await page.waitForSelector('button:has-text("Start Session")', { timeout: 10000 });

    // Click Start Session
    await page.click('button:has-text("Start Session")');

    // Wait for modal
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    // Select machine
    await page.click('[role="combobox"]');
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 });

    // Find and click the machine option
    const machineOption = page.locator(`[role="option"]`).filter({ hasText: MACHINE_NAME }).first();
    await machineOption.click();

    // Clear command and type 'claude' (it may already have it)
    const commandInput = page.locator('input[placeholder*="claude"]');
    await commandInput.fill('claude');

    // Click Start Session button in modal
    await page.click('[role="dialog"] button:has-text("Start Session")');

    // Wait for navigation to new session or for modal to close
    await page.waitForTimeout(2000);

    // Extract session ID from URL if redirected, or from the sessions list
    const url = page.url();
    const urlMatch = url.match(/\/sessions\/([0-9a-f-]{36})/);
    if (urlMatch) {
      process.stdout.write(`SESSION_ID=${urlMatch[1]}\n`);
      await browser.close();
      return;
    }

    // If still on sessions page, find the most recent running session
    await page.waitForTimeout(1000);
    await page.goto(`${BASE_URL}/sessions`, { waitUntil: 'networkidle', timeout: 10000 });

    // Get the first running session link
    const sessionLinks = await page.locator('a[href^="/sessions/"]').all();
    for (const link of sessionLinks) {
      const href = await link.getAttribute('href');
      const sessionId = href?.match(/\/sessions\/([0-9a-f-]{36})/)?.[1];
      if (sessionId) {
        // Check if it's running (look for "Running" text in the same row)
        const row = link.locator('..');
        const statusText = await row.textContent().catch(() => '');
        if (statusText?.includes('Running') && !statusText?.includes('ago')) {
          process.stdout.write(`SESSION_ID=${sessionId}\n`);
          break;
        }
        // Just take the first one if we can't determine status
        process.stdout.write(`SESSION_ID=${sessionId}\n`);
        break;
      }
    }

    // Save auth state for future runs
    await context.storageState({ path: STATE_FILE });

  } catch (err) {
    process.stderr.write(`[start-session] Error: ${err.message}\n`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
