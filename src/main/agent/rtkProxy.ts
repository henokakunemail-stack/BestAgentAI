// RTK (Rust Token Killer) Output Proxy Sanitizer
// Strips ANSI escapes, spinner progress lines, and limits noisy logs to save 70-90% context tokens

export function sanitizeTerminalOutput(rawOutput: string): string {
  if (!rawOutput) return ''

  // 1. Strip ANSI escape sequences
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g
  let clean = rawOutput.replace(ansiRegex, '')

  // 2. Strip carriage returns from terminal animations
  clean = clean.replace(/\r/g, '\n')

  // 3. Filter noise lines (spinners, download progress, redundant checking)
  const noisePatterns = [
    /^\s*Compiling\s+/i,
    /^\s*Checking\s+/i,
    /^\s*Downloading\s+/i,
    /^\s*Fetching\s+/i,
    /^\s*Extracting\s+/i,
    /\[\d+\/\d+\]/
  ]

  const lines = clean.split('\n')
  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return true
    return !noisePatterns.some((pattern) => pattern.test(trimmed))
  })

  // 4. Token truncation threshold (keep last 50 lines if output exceeds)
  if (filtered.length > 50) {
    const head = filtered.slice(0, 5)
    const tail = filtered.slice(-45)
    return `[... ${filtered.length - 50} lines compressed by RTK Proxy ...]\n` + [...head, '...', ...tail].join('\n')
  }

  return filtered.join('\n')
}
