import { db, notifications } from '@/db'

export type NotificationType = 'session_crashed' | 'machine_offline'

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  resourceId?: string
): Promise<void> {
  await db.insert(notifications).values({
    userId,
    type,
    title,
    body,
    resourceId: resourceId ?? null,
  })
}
