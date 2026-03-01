import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, orgInvites, organizations } from '@/db'
import InviteAcceptClient from './accept-client'

interface Props {
  params: { token: string }
}

export default async function InvitePage({ params }: Props) {
  const { token } = params

  const [invite] = await db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      expiresAt: orgInvites.expiresAt,
      acceptedAt: orgInvites.acceptedAt,
      orgId: orgInvites.orgId,
    })
    .from(orgInvites)
    .where(eq(orgInvites.token, token))
    .limit(1)

  if (!invite) {
    notFound()
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, invite.orgId))
    .limit(1)

  const expired = invite.expiresAt < new Date()
  const accepted = !!invite.acceptedAt

  return (
    <InviteAcceptClient
      token={token}
      orgName={org?.name ?? 'an organization'}
      email={invite.email}
      expired={expired}
      accepted={accepted}
    />
  )
}
