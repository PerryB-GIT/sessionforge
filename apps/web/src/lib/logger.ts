/**
 * Structured JSON logger for Cloud Logging compatibility.
 *
 * In production (Cloud Run), logs are emitted as JSON objects so
 * Cloud Logging can parse severity, trace, and labels automatically.
 * In development, logs are formatted as readable text.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.info('User signed in', { userId })
 *   logger.error('Stripe webhook failed', { error: err.message, event })
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'

interface LogEntry {
  severity: LogLevel
  message: string
  [key: string]: unknown
}

function emit(level: LogLevel, message: string, fields?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') {
    const entry: LogEntry = { severity: level, message, ...fields }
    // Cloud Logging picks up structured JSON written to stdout
    process.stdout.write(JSON.stringify(entry) + '\n')
  } else {
    const prefix = `[${level}]`
    const extra = fields ? ' ' + JSON.stringify(fields) : ''
    const fn = level === 'ERROR' ? console.error : level === 'WARNING' ? console.warn : console.log
    fn(`${prefix} ${message}${extra}`)
  }
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('DEBUG', message, fields),
  info:  (message: string, fields?: Record<string, unknown>) => emit('INFO',  message, fields),
  warn:  (message: string, fields?: Record<string, unknown>) => emit('WARNING', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('ERROR', message, fields),
}
