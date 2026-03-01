import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('recordingRedisKey', () => {
  it('returns the correct key format', async () => {
    const { recordingRedisKey } = await import('../recording')
    expect(recordingRedisKey('session-123')).toBe('recording:session-123')
  })
})

describe('appendRecordingFrame', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('../redis', () => ({
      redis: {
        lpush: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
      },
    }))
    vi.doMock('@google-cloud/storage', () => ({
      Storage: vi.fn(),
    }))
  })

  it('calls lpush and expire on redis', async () => {
    const { appendRecordingFrame } = await import('../recording')
    const { redis } = await import('../redis')
    const startedAt = new Date(Date.now() - 5000)
    await appendRecordingFrame('sess-1', Buffer.from('hello').toString('base64'), startedAt)
    expect(redis.lpush).toHaveBeenCalledOnce()
    expect(redis.expire).toHaveBeenCalledOnce()
  })

  it('stores a valid JSON frame string', async () => {
    const { appendRecordingFrame } = await import('../recording')
    const { redis } = await import('../redis')
    const startedAt = new Date(Date.now() - 2000)
    const text = 'hello world'
    await appendRecordingFrame('sess-2', Buffer.from(text).toString('base64'), startedAt)

    // Check the lpush was called with a valid asciinema frame
    const callArgs = (redis.lpush as ReturnType<typeof vi.fn>).mock.calls[0]
    const frameStr = callArgs[1] as string
    const frame = JSON.parse(frameStr) as [number, string, string]
    expect(frame).toHaveLength(3)
    expect(typeof frame[0]).toBe('number') // timestamp
    expect(frame[1]).toBe('o') // event type
    expect(frame[2]).toBe(text) // decoded text
  })
})

describe('archiveSessionRecording', () => {
  it('uploads a gzipped cast file to GCS and deletes the redis key', async () => {
    vi.resetModules()

    const mockSave = vi.fn().mockResolvedValue(undefined)
    const mockFile = vi.fn().mockReturnValue({ save: mockSave })
    const mockBucket = vi.fn().mockReturnValue({ file: mockFile })
    const mockDel = vi.fn().mockResolvedValue(1)

    vi.doMock('../redis', () => ({
      redis: {
        lrange: vi.fn().mockResolvedValue([
          // lpush stores newest first, so index 0 is latest frame (t=5.0)
          JSON.stringify([5.0, 'o', 'last line']),
          JSON.stringify([2.0, 'o', 'middle']),
          JSON.stringify([0.5, 'o', 'first line']),
        ]),
        del: mockDel,
      },
    }))

    // Use a class so `new Storage()` works
    vi.doMock('@google-cloud/storage', () => ({
      Storage: class MockStorage {
        bucket = mockBucket
      },
    }))

    const { archiveSessionRecording } = await import('../recording')
    const startedAt = new Date()
    await archiveSessionRecording('sess-archive', 'org-abc', startedAt)

    expect(mockBucket).toHaveBeenCalledWith(expect.stringContaining('sessionforge'))
    expect(mockFile).toHaveBeenCalledWith('session-recordings/org-abc/sess-archive.cast.gz')
    expect(mockSave).toHaveBeenCalledOnce()
    expect(mockDel).toHaveBeenCalledOnce()
  })

  it('does nothing when there are no frames', async () => {
    vi.resetModules()

    const mockSave = vi.fn()
    vi.doMock('../redis', () => ({
      redis: {
        lrange: vi.fn().mockResolvedValue([]),
        del: vi.fn(),
      },
    }))
    vi.doMock('@google-cloud/storage', () => ({
      Storage: class MockStorage {
        bucket = vi.fn().mockReturnValue({
          file: vi.fn().mockReturnValue({ save: mockSave }),
        })
      },
    }))

    const { archiveSessionRecording } = await import('../recording')
    await archiveSessionRecording('sess-empty', 'org-abc', new Date())
    expect(mockSave).not.toHaveBeenCalled()
  })
})
