import zlib from 'zlib'
import { promisify } from 'util'
import { Storage } from '@google-cloud/storage'
import { redis } from './redis'

const gzip = promisify(zlib.gzip)
const BUCKET = process.env.GCS_BUCKET_LOGS ?? 'sessionforge-logs'
const RECORDING_TTL_SECONDS = 365 * 24 * 60 * 60 // 1 year

export function recordingRedisKey(sessionId: string): string {
  return `recording:${sessionId}`
}

/**
 * Append a terminal output frame to the recording buffer in Redis.
 * base64Data: the raw terminal bytes, base64-encoded.
 * sessionStartedAt: the timestamp when the session began (for relative timing).
 */
export async function appendRecordingFrame(
  sessionId: string,
  base64Data: string,
  sessionStartedAt: Date
): Promise<void> {
  try {
    const t = (Date.now() - sessionStartedAt.getTime()) / 1000
    const text = Buffer.from(base64Data, 'base64').toString('utf8')
    const frame = JSON.stringify([t, 'o', text])
    const key = recordingRedisKey(sessionId)
    // Upstash Redis lpush signature: lpush(key, ...values)
    await redis.lpush(key, frame)
    await redis.expire(key, RECORDING_TTL_SECONDS)
  } catch (err) {
    console.error('[recording] appendRecordingFrame error:', err)
  }
}

/**
 * Archive the Redis recording buffer to GCS in asciinema v2 .cast.gz format.
 * Called when a session stops.
 */
export async function archiveSessionRecording(
  sessionId: string,
  orgId: string,
  startedAt: Date,
  width = 220,
  height = 50
): Promise<void> {
  try {
    const key = recordingRedisKey(sessionId)
    // lrange(key, 0, -1) returns all items. With lpush, index 0 is the NEWEST frame.
    const frames = await redis.lrange(key, 0, -1)
    if (!frames || frames.length === 0) return

    // lpush pushes to the front, so frames[0] is newest — reverse for chronological order
    const chronological = [...frames].reverse()

    const lastFrame = JSON.parse(chronological[chronological.length - 1]) as [
      number,
      string,
      string,
    ]
    const durationSeconds = lastFrame[0]

    const header = JSON.stringify({
      version: 2,
      width,
      height,
      timestamp: Math.floor(startedAt.getTime() / 1000),
      duration: durationSeconds,
      title: `Session ${sessionId}`,
    })

    const cast = [header, ...chronological].join('\n') + '\n'
    const compressed = await gzip(Buffer.from(cast, 'utf8'))

    const storage = new Storage()
    const bucket = storage.bucket(BUCKET)
    const gcsPath = `session-recordings/${orgId}/${sessionId}.cast.gz`
    await bucket.file(gcsPath).save(compressed, {
      metadata: { contentType: 'application/gzip', contentEncoding: 'gzip' },
    })

    // Clean up Redis buffer after successful archive
    await redis.del(key)
  } catch (err) {
    console.error('[recording] archiveSessionRecording error:', err)
  }
}

/**
 * Get a signed URL for streaming playback of a session recording.
 * Returns null if the recording does not exist.
 */
export async function getRecordingSignedUrl(
  sessionId: string,
  orgId: string
): Promise<string | null> {
  try {
    const storage = new Storage()
    const bucket = storage.bucket(BUCKET)
    const gcsPath = `session-recordings/${orgId}/${sessionId}.cast.gz`
    const file = bucket.file(gcsPath)

    const [exists] = await file.exists()
    if (!exists) return null

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    })
    return url
  } catch (err) {
    console.error('[recording] getRecordingSignedUrl error:', err)
    return null
  }
}
