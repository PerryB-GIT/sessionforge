import { Storage } from '@google-cloud/storage'
import zlib from 'zlib'
import { promisify } from 'util'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

function getStorage() {
  // On Cloud Run, ADC (Application Default Credentials) are used automatically.
  // In development, set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.
  return new Storage()
}

function getBucket() {
  const bucket = process.env.GCS_BUCKET_LOGS
  if (!bucket) throw new Error('GCS_BUCKET_LOGS env var is not set')
  return getStorage().bucket(bucket)
}

export async function archiveSessionLogs(
  sessionId: string,
  userId: string,
  lines: string[]
): Promise<void> {
  if (lines.length === 0) return

  const content = lines.join('\n')
  const compressed = await gzip(Buffer.from(content, 'utf-8'))

  const file = getBucket().file(`session-logs/${userId}/${sessionId}.ndjson.gz`)
  await file.save(compressed, {
    contentType: 'application/gzip',
    metadata: { sessionId, userId },
  })
}

export async function fetchLogsFromGCS(
  sessionId: string,
  userId: string,
  offset: number,
  limit: number
): Promise<{ lines: string[]; total: number }> {
  // If GCS is not configured (e.g. local dev), return empty result silently rather
  // than throwing and producing noisy error logs in the caller's catch block.
  if (!process.env.GCS_BUCKET_LOGS) {
    return { lines: [], total: 0 }
  }

  const file = getBucket().file(`session-logs/${userId}/${sessionId}.ndjson.gz`)

  const [exists] = await file.exists()
  if (!exists) return { lines: [], total: 0 }

  const [compressed] = await file.download()
  const content = (await gunzip(compressed)).toString('utf-8')
  const allLines = content.split('\n').filter(Boolean)

  return {
    lines: allLines.slice(offset, offset + limit),
    total: allLines.length,
  }
}
