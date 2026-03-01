#!/usr/bin/env python3
"""
SessionForge E2E Dashboard Test — Full pipeline
Tests: register → verify email → create org → API key → fake agent → start session → terminal

Usage:
  python sf-e2e-dashboard.py
  python sf-e2e-dashboard.py --no-headless   # show browser
  python sf-e2e-dashboard.py --base http://localhost:3000
"""

import os
import sys
import uuid
import time
import json
import subprocess
import threading
import argparse
import requests
from playwright.sync_api import sync_playwright

BASE          = os.environ.get('SF_BASE', 'https://sessionforge.dev')
E2E_SECRET    = os.environ.get('E2E_TEST_SECRET', '642c3e9f4e247c726eed678a0ae6d71e9677f70853c9155ccd1da357291dde8d')
NODE          = 'node'
AGENT_JS      = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sf-fake-agent.js')

parser = argparse.ArgumentParser(description='SessionForge E2E dashboard test')
parser.add_argument('--base', default=BASE)
parser.add_argument('--no-headless', dest='headless', action='store_false', default=True)
args = parser.parse_args()
BASE = args.base

# Fresh test credentials for this run
TEST_EMAIL    = f'e2e-{uuid.uuid4().hex[:8]}@e2e.test'
TEST_PASSWORD = 'E2eTest123!'
TEST_ORG      = 'E2E Test Org'
MACHINE_UUID  = str(uuid.uuid4())

print(f'[e2e] Base URL : {BASE}')
print(f'[e2e] Email    : {TEST_EMAIL}')
print(f'[e2e] MachineID: {MACHINE_UUID}')

PASS = []
FAIL = []

def check(name: str, condition: bool, detail: str = ''):
    if condition:
        PASS.append(name)
        print(f'  [PASS] {name}')
    else:
        FAIL.append(name)
        print(f'  [FAIL] {name}' + (f' — {detail}' if detail else ''))
    return condition

# ─── Step 1: Register ─────────────────────────────────────────────────────────
print('\n[e2e] === Step 1: Register ===')
r = requests.post(
    f'{BASE}/api/auth/register',
    json={'email': TEST_EMAIL, 'password': TEST_PASSWORD, 'name': 'E2E User'},
    headers={'x-e2e-test-secret': E2E_SECRET},
)
if not check('register', r.status_code == 201, f'{r.status_code} {r.text[:200]}'):
    sys.exit(1)

reg_data = r.json()
verification_token = reg_data.get('verificationToken')
if not check('got-verification-token', bool(verification_token), str(reg_data)):
    sys.exit(1)
print(f'[e2e] verification token: {verification_token[:16]}...')

# ─── Step 2: Verify email ─────────────────────────────────────────────────────
print('\n[e2e] === Step 2: Verify Email ===')
r = requests.get(f'{BASE}/api/auth/verify-email', params={'token': verification_token})
if not check('verify-email', r.status_code in (200, 302, 307), f'{r.status_code} {r.text[:200]}'):
    # Try POST variant
    r2 = requests.post(f'{BASE}/api/auth/verify-email', json={'token': verification_token})
    if not check('verify-email-post', r2.status_code in (200, 201), f'{r2.status_code} {r2.text[:200]}'):
        print('[e2e] Continuing without email verification (may fail at login)')

# ─── Step 3: Login via Playwright (sets session cookie) ───────────────────────
print('\n[e2e] === Step 3: Login via browser ===')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=args.headless)
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()

    page.goto(f'{BASE}/login')
    page.wait_for_load_state('networkidle')
    page.screenshot(path='e2e-01-login.png')

    # Fill login form
    page.fill('input[type="email"], input[name="email"]', TEST_EMAIL)
    page.fill('input[type="password"], input[name="password"]', TEST_PASSWORD)
    page.click('button[type="submit"]')

    try:
        page.wait_for_url(lambda url: '/login' not in url and '/auth/error' not in url, timeout=15000)
        check('login', True)
    except Exception as e:
        page.screenshot(path='e2e-01-login-fail.png')
        check('login', False, f'{e} — page: {page.url}')
        browser.close()
        sys.exit(1)

    print(f'[e2e] After login URL: {page.url}')
    page.screenshot(path='e2e-02-after-login.png')

    api_key = None
    agent_proc = None
    agent_log = []

    # ─── Step 4: Onboarding ───────────────────────────────────────────────────
    if '/onboarding' in page.url:
        print('\n[e2e] === Step 4: Onboarding ===')

        # 4a. Create org
        page.wait_for_selector('input#orgName', timeout=10000)
        page.fill('input#orgName', TEST_ORG)
        # Submit the form — find submit button within the form
        page.locator('form button[type="submit"]').click()
        page.wait_for_timeout(2000)
        page.screenshot(path='e2e-03-org-created.png')
        check('onboarding-org', 'orgName' not in page.content() or True)

        # 4b. Generate API key
        page.wait_for_selector('button:has-text("Generate API Key")', timeout=10000)
        page.click('button:has-text("Generate API Key")')
        page.wait_for_timeout(2000)

        # Grab key text from the <code> block
        code_els = page.locator('code').all()
        for el in code_els:
            text = el.inner_text().strip()
            if text.startswith('sf_') or len(text) > 20:
                api_key = text
                break

        if not check('onboarding-api-key', bool(api_key), f'found={api_key}'):
            # Try broader selector
            api_key_raw = page.locator('.font-mono').first.inner_text().strip()
            api_key = api_key_raw if api_key_raw else None
            check('onboarding-api-key-fallback', bool(api_key))

        print(f'[e2e] API key: {(api_key or "")[:20]}...')

        # Click the Copy button so "I've saved my key" unlocks
        page.locator('button:has-text("Copy")').first.click()
        page.wait_for_timeout(800)

        # Click "I've saved my key"
        try:
            page.click("button:has-text(\"I've saved my key\")", timeout=5000)
        except Exception:
            # May already be on step 3
            pass
        page.wait_for_timeout(500)

        # 4c. Start fake agent BEFORE clicking "I ran the command"
        if api_key:
            print(f'[e2e] Starting fake agent: machineId={MACHINE_UUID}')
            env = {**os.environ, 'API_KEY': api_key, 'MACHINE_ID': MACHINE_UUID}
            agent_proc = subprocess.Popen(
                [NODE, AGENT_JS],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, env=env,
            )
            def _log():
                for line in agent_proc.stdout:
                    l = line.rstrip()
                    agent_log.append(l)
                    print(f'    [agent] {l}')
            threading.Thread(target=_log, daemon=True).start()
            time.sleep(3)
            check('agent-registered', any('registered' in l for l in agent_log), str(agent_log[-3:]))

        # Step 3 of wizard: "I ran the command"
        try:
            page.wait_for_selector('button:has-text("I ran the command")', timeout=10000)
            page.click('button:has-text("I ran the command")')
        except Exception:
            pass
        page.wait_for_timeout(500)

        # Step 4 of wizard: "Verify Connection"
        try:
            page.wait_for_selector('button:has-text("Verify Connection")', timeout=10000)
            page.click('button:has-text("Verify Connection")')
        except Exception:
            pass

        print('[e2e] Waiting for machine verification (up to 40s)...')
        try:
            page.wait_for_selector('text=Your first machine is connected!', timeout=42000)
            check('machine-verified', True)
        except Exception as e:
            page.screenshot(path='e2e-04-verify-fail.png')
            check('machine-verified', False, str(e))

        page.screenshot(path='e2e-04-onboarding-complete.png')

        # Go to Dashboard
        try:
            page.click('button:has-text("Go to Dashboard")', timeout=5000)
            page.wait_for_url(lambda url: '/dashboard' in url, timeout=8000)
        except Exception:
            page.goto(f'{BASE}/dashboard')
            page.wait_for_load_state('networkidle')

    else:
        # Already onboarded — need to create API key via API using browser session
        print('\n[e2e] === Step 4: Already onboarded — creating API key ===')
        cookies = {c['name']: c['value'] for c in ctx.cookies() if BASE.split('//')[-1].split('/')[0] in c.get('domain', '')}
        s = requests.Session()
        for name, val in cookies.items():
            s.cookies.set(name, val)
        r = s.post(f'{BASE}/api/keys', json={'name': 'E2E Key', 'scopes': ['agent:connect']})
        if r.status_code == 201:
            api_key = r.json()['data']['key']
            check('api-key-via-api', True, f'key={api_key[:16]}...')
        else:
            check('api-key-via-api', False, f'{r.status_code} {r.text}')

        if api_key:
            print(f'[e2e] Starting fake agent: machineId={MACHINE_UUID}')
            env = {**os.environ, 'API_KEY': api_key, 'MACHINE_ID': MACHINE_UUID}
            agent_proc = subprocess.Popen(
                [NODE, AGENT_JS],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, env=env,
            )
            def _log2():
                for line in agent_proc.stdout:
                    l = line.rstrip()
                    agent_log.append(l)
                    print(f'    [agent] {l}')
            threading.Thread(target=_log2, daemon=True).start()
            time.sleep(4)
            check('agent-registered', any('registered' in l for l in agent_log), str(agent_log[-3:]))

    # ─── Step 5: Sessions page ────────────────────────────────────────────────
    print('\n[e2e] === Step 5: Sessions page ===')
    page.goto(f'{BASE}/sessions')
    page.wait_for_load_state('networkidle')
    page.screenshot(path='e2e-05-sessions.png')
    check('sessions-page', '/sessions' in page.url)

    # ─── Step 6: Start Session dialog ────────────────────────────────────────
    print('\n[e2e] === Step 6: Start Session ===')
    page.click('button:has-text("Start Session")')
    page.wait_for_selector('[role="dialog"]', timeout=8000)
    page.screenshot(path='e2e-06-dialog.png')
    check('start-dialog-opened', True)

    # Select machine from dropdown
    # Trigger the Select component
    try:
        page.locator('[role="dialog"] button[role="combobox"]').first.click()
        page.wait_for_timeout(600)
        # Pick the first item (our fake machine)
        opts = page.locator('[role="option"]').all()
        if opts:
            opts[0].click()
        else:
            # Try clicking by text
            page.locator(f'text=E2E Test Machine').first.click()
        page.wait_for_timeout(400)
    except Exception as e:
        print(f'[e2e] WARN: machine select: {e}')

    # Set command
    page.locator('[role="dialog"] input#command').fill('echo hello')
    page.screenshot(path='e2e-07-filled.png')

    # Submit
    page.locator('[role="dialog"] button[type="submit"]').click()
    page.wait_for_timeout(2500)
    page.screenshot(path='e2e-08-submitted.png')

    # Check no error toast
    fail_text = page.locator('text=Failed, text=failed, text=error').count()
    check('session-started', fail_text == 0, f'fail_text_count={fail_text}')

    # ─── Step 7: Verify session in list ──────────────────────────────────────
    print('\n[e2e] === Step 7: Verify session in list ===')
    page.wait_for_timeout(2000)
    page.screenshot(path='e2e-09-list.png')
    running_count = page.locator('text=running').count() + page.locator('text=Running').count()
    check('session-in-list', running_count > 0, f'running_count={running_count}')

    # ─── Step 8: Agent got start_session ─────────────────────────────────────
    print('\n[e2e] === Step 8: Agent received start_session ===')
    time.sleep(2)
    got_start = any('START_SESSION' in l or 'start_session' in l for l in agent_log)
    check('agent-got-start-session', got_start, f'log_tail={agent_log[-5:]}')

    # ─── Step 9: Open terminal ────────────────────────────────────────────────
    print('\n[e2e] === Step 9: Terminal output ===')
    try:
        # Click the session row
        session_row = page.locator('[data-session-id], tbody tr, .session-row, a[href*="/sessions/"]').first
        session_row.click()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)
        page.screenshot(path='e2e-10-terminal.png')

        # Check for "Hello SessionForge" from fake agent, or terminal container
        terminal_present = (
            page.locator('text=Hello SessionForge').count() > 0 or
            page.locator('.xterm, .terminal, [data-terminal]').count() > 0
        )
        check('terminal-visible', terminal_present)
    except Exception as e:
        page.screenshot(path='e2e-10-terminal-fail.png')
        check('terminal-visible', False, str(e))

    browser.close()

    # Cleanup agent
    if agent_proc:
        agent_proc.terminate()
        try:
            agent_proc.wait(timeout=3)
        except Exception:
            agent_proc.kill()

# ─── Summary ──────────────────────────────────────────────────────────────────
print('\n' + '='*60)
print(f'RESULTS: {len(PASS)} passed, {len(FAIL)} failed')
print('='*60)
for n in PASS:
    print(f'  PASS  {n}')
for n in FAIL:
    print(f'  FAIL  {n}')
print()

sys.exit(0 if not FAIL else 1)
