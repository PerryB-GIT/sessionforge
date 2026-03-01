const { Client } = require('pg')
const bcrypt = require('bcryptjs')

async function seed() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5433,
    database: 'sessionforge',
    user: 'sessionforge',
    password: 'H2nNfxVWBqUlIau7MZO8paTrK4qBIBYN',
  })

  await client.connect()
  console.log('Connected to Cloud SQL')

  const hash = await bcrypt.hash('E2eTestPass123!', 12)
  const now = new Date().toISOString()

  // Check existing
  const existing = await client.query(
    "SELECT email, plan FROM users WHERE email IN ('test@sessionforge.dev', 'pro@sessionforge.dev')"
  )
  console.log('Existing rows:', existing.rows)

  // Upsert free test user
  await client.query(
    `INSERT INTO users (id, email, name, password_hash, email_verified, plan, onboarding_completed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $4, $4, $4)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       email_verified = EXCLUDED.email_verified,
       plan = EXCLUDED.plan,
       onboarding_completed_at = EXCLUDED.onboarding_completed_at,
       updated_at = EXCLUDED.updated_at`,
    ['test@sessionforge.dev', 'E2E Test User', hash, now, 'free']
  )
  console.log('Upserted: test@sessionforge.dev (free)')

  // Upsert pro test user
  await client.query(
    `INSERT INTO users (id, email, name, password_hash, email_verified, plan, onboarding_completed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $4, $4, $4)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       email_verified = EXCLUDED.email_verified,
       plan = EXCLUDED.plan,
       onboarding_completed_at = EXCLUDED.onboarding_completed_at,
       updated_at = EXCLUDED.updated_at`,
    ['pro@sessionforge.dev', 'E2E Pro User', hash, now, 'pro']
  )
  console.log('Upserted: pro@sessionforge.dev (pro)')

  // Verify
  const result = await client.query(
    "SELECT email, plan, email_verified IS NOT NULL as verified FROM users WHERE email IN ('test@sessionforge.dev', 'pro@sessionforge.dev')"
  )
  console.log('\nVerification:')
  result.rows.forEach(r => console.log(' ', r.email, '| plan:', r.plan, '| verified:', r.verified))

  await client.end()
  console.log('\nDone.')
}

seed().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
