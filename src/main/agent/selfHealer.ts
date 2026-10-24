// Antigravity Self-Healing Engine
// Detects compiler, runtime and syntax errors, isolates failure context,
// and crafts targeted self-correction prompts for the agent loop

export interface ErrorReport {
  isError: boolean
  file?: string
  line?: number
  message: string
}

export function parseExecutionError(output: string): ErrorReport {
  if (!output) return { isError: false, message: '' }

  // Check for common error signatures
  const errorIndicators = ['Error:', 'TypeError:', 'SyntaxError:', 'ReferenceError:', 'panic:', 'FAILED', 'FAIL']
  const hasError = errorIndicators.some((indicator) => output.includes(indicator))

  if (!hasError) {
    return { isError: false, message: '' }
  }

  // Regex for line number extraction
  const fileLineMatch = output.match(/(?:at\s+|in\s+)?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/)

  return {
    isError: true,
    file: fileLineMatch ? fileLineMatch[1] : undefined,
    line: fileLineMatch ? parseInt(fileLineMatch[2], 10) : undefined,
    message: output.slice(0, 500)
  }
}

export function buildSelfHealingPrompt(error: ErrorReport): string {
  return `[Antigravity Self-Healing Loop Activated]
Detected failure during execution:
File: ${error.file || 'Unknown'}
Line: ${error.line || 'Unknown'}
Error snippet:
${error.message}

Please inspect this error, formulate a corrective patch, and verify the fix without introducing regressions.`
}
