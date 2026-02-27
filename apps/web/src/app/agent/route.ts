import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

// GET /agent — serves the Linux/macOS shell installer script
// Used by: curl -fsSL https://get.sessionforge.io/agent | bash -s -- --key sf_live_xxx
export async function GET() {
  // Read from public/agent/install.sh at build time
  // In production (Cloud Run), the public dir is bundled with the Next.js output
  let script: string
  try {
    script = readFileSync(join(process.cwd(), 'public', 'agent', 'install.sh'), 'utf-8')
  } catch {
    // Fallback: return 404 with clear message
    return new NextResponse('Install script not found. Visit https://sessionforge.dev for help.\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // No caching — always serve latest version
      'Cache-Control': 'no-store',
    },
  })
}
