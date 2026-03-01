import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, users } from '@/db'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [user] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  const plan = user?.plan ?? 'free'

  // Return the fresh plan. The client (StripeRedirectHandler / useSession)
  // must call useSession().update({ plan }) with this value — that triggers
  // the jwt() callback with trigger='update', which re-issues the cookie.
  return NextResponse.json({ ok: true, plan })
}
