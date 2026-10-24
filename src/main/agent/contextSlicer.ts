// Codex Context Slicer
// Extracts types, interfaces, function signatures, and exported classes
// Leaves function bodies out to minimize token consumption while maintaining complete type context

export function sliceContext(sourceCode: string): string {
  if (!sourceCode) return ''

  const lines = sourceCode.split('\n')
  const sliced: string[] = []
  let insideFunctionBody = false
  let braceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // Keep imports, types, interfaces, and export declarations
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export type ') ||
      trimmed.startsWith('export interface ') ||
      trimmed.startsWith('type ') ||
      trimmed.startsWith('interface ')
    ) {
      sliced.push(line)
      continue
    }

    // Function/Method signatures
    if (
      (trimmed.startsWith('export function ') ||
        trimmed.startsWith('export const ') ||
        trimmed.startsWith('export class ') ||
        trimmed.startsWith('function ')) &&
      line.includes('{')
    ) {
      const signature = line.substring(0, line.indexOf('{')).trim()
      sliced.push(`${signature} { /* [Context Slicer: body omitted] */ }`)
      continue
    }

    // Track braces if inside class
    if (trimmed.startsWith('export class ') || trimmed.startsWith('class ')) {
      sliced.push(line)
      continue
    }
  }

  return sliced.length > 0 ? sliced.join('\n') : sourceCode.slice(0, 1000)
}
