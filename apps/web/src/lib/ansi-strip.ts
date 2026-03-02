const ANSI_PATTERN = /\x1B\[[0-9;]*[A-Za-z]|\x1B\][^\x07]*\x07|\x1B[PX^_][^\x1B]*\x1B\\|\r/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

export function decodeLogsForLlm(base64Lines: string[], maxLines = 100): string {
  return base64Lines
    .map((l) => {
      try {
        return stripAnsi(atob(l))
      } catch {
        return ''
      }
    })
    .join('')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(-maxLines)
    .join('\n')
}
