// Codex AGENTS.md / Antigravity GEMINI.md discovery: walk up from cwd, nearest file wins priority.
// Caps: 24 KB per file, 20k-token (~80 KB) aggregate.
import { promises as fs } from 'node:fs'
import path from 'node:path'

const NAMES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']
const PER_FILE = 24 * 1024
const TOTAL = 80 * 1024

export async function loadProjectDocs(startDir: string): Promise<string> {
  const found: Array<{ file: string; text: string }> = []
  let dir = path.resolve(startDir)
  for (;;) {
    for (const n of NAMES) {
      const file = path.join(dir, n)
      const text = await fs.readFile(file, 'utf8').catch(() => null)
      if (text) found.push({ file, text: text.slice(0, PER_FILE) })
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // outermost first, nearest last (nearest overrides)
  let out = ''
  for (const f of found.reverse()) {
    const block = `\n[Project instructions: ${f.file}]\n${f.text}\n`
    if (out.length + block.length > TOTAL) break
    out += block
  }
  return out
}
