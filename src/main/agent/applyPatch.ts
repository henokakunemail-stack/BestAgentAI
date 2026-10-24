// Codex-style apply_patch: context-anchored hunks (no line numbers), strict parse errors
// fed back to the model, CRLF preserved, workspace-root allowlist, no-op rejection.
import { promises as fs } from 'node:fs'
import path from 'node:path'

type Chunk = { header?: string; lines: string[] } // lines keep their ' ', '-', '+' prefix
type Op =
  | { kind: 'add'; file: string; lines: string[] }
  | { kind: 'delete'; file: string }
  | { kind: 'update'; file: string; moveTo?: string; chunks: Chunk[] }

export function parsePatch(text: string): Op[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trim() !== '*** Begin Patch') throw new Error("first line must be '*** Begin Patch'")
  let end = lines.length - 1
  while (end > 0 && lines[end].trim() === '') end--
  if (lines[end].trim() !== '*** End Patch') throw new Error("last line must be '*** End Patch'")

  const ops: Op[] = []
  let i = 1
  while (i < end) {
    const l = lines[i]
    if (l.startsWith('*** Add File: ')) {
      const body: string[] = []
      i++
      while (i < end && !lines[i].startsWith('*** ')) {
        if (!lines[i].startsWith('+')) throw new Error(`Add File line ${i + 1} must start with '+'`)
        body.push(lines[i].slice(1))
        i++
      }
      ops.push({ kind: 'add', file: l.slice(14).trim(), lines: body })
    } else if (l.startsWith('*** Delete File: ')) {
      ops.push({ kind: 'delete', file: l.slice(17).trim() })
      i++
    } else if (l.startsWith('*** Update File: ')) {
      const op: Op = { kind: 'update', file: l.slice(17).trim(), chunks: [] }
      i++
      if (lines[i]?.startsWith('*** Move to: ')) {
        op.moveTo = lines[i].slice(13).trim()
        i++
      }
      let cur: Chunk | null = null
      while (i < end && !(lines[i].startsWith('*** ') && lines[i] !== '*** End of File')) {
        const c = lines[i]
        if (c.startsWith('@@')) {
          cur = { header: c.slice(2).trim() || undefined, lines: [] }
          op.chunks.push(cur)
        } else if (c === '*** End of File') {
          // marker only; chunk already anchored by context
        } else if (c === '' || /^[ +-]/.test(c)) {
          if (!cur) op.chunks.push((cur = { lines: [] }))
          cur.lines.push(c === '' ? ' ' : c)
        } else {
          throw new Error(`line ${i + 1}: unexpected '${c.slice(0, 30)}' in Update File`)
        }
        i++
      }
      if (op.chunks.length === 0 && !op.moveTo) throw new Error(`Update File ${op.file} has no hunks`)
      ops.push(op)
    } else {
      throw new Error(`'${l.slice(0, 40)}' is not a valid hunk header (use Add File / Update File / Delete File)`)
    }
  }
  if (ops.length === 0) throw new Error('patch contains no operations')
  return ops
}

function findSeq(hay: string[], needle: string[], from: number): number {
  outer: for (let s = from; s + needle.length <= hay.length; s++) {
    for (let k = 0; k < needle.length; k++) if (hay[s + k] !== needle[k]) continue outer
    return s
  }
  // second pass: tolerate trailing whitespace drift
  outer2: for (let s = from; s + needle.length <= hay.length; s++) {
    for (let k = 0; k < needle.length; k++) if (hay[s + k].trimEnd() !== needle[k].trimEnd()) continue outer2
    return s
  }
  return -1
}

export function applyChunks(original: string, chunks: Chunk[], file: string): string {
  const crlf = original.includes('\r\n')
  const src = original.replace(/\r\n/g, '\n').split('\n')
  let cursor = 0
  for (const ch of chunks) {
    if (ch.header) {
      const h = findSeq(src, [ch.header], cursor)
      if (h < 0) throw new Error(`${file}: context anchor '@@ ${ch.header}' not found`)
      cursor = h
    }
    const oldL = ch.lines.filter((x) => x[0] !== '+').map((x) => x.slice(1))
    const newL = ch.lines.filter((x) => x[0] !== '-').map((x) => x.slice(1))
    if (oldL.join('\n') === newL.join('\n')) throw new Error(`${file}: hunk is a no-op`)
    // pure insertion (no context): append at end
    const at = oldL.length === 0 ? src.length : findSeq(src, oldL, cursor)
    if (at < 0) throw new Error(`${file}: could not locate hunk context:\n${oldL.slice(0, 3).join('\n')}`)
    src.splice(at, oldL.length, ...newL)
    cursor = at + newL.length
  }
  const out = src.join('\n')
  return crlf ? out.replace(/\n/g, '\r\n') : out
}

function safe(root: string, file: string): string {
  const abs = path.resolve(root, file)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path outside workspace: ${file}`)
  return abs
}

/** Dry-run first (validates every op), then write. Returns a summary. */
export async function applyPatch(text: string, root: string): Promise<string> {
  const ops = parsePatch(text)
  const writes: Array<{ abs: string; data: string | null; from?: string }> = []
  const report: string[] = []
  for (const op of ops) {
    const abs = safe(root, op.file)
    if (op.kind === 'add') {
      if (await fs.stat(abs).then(() => true, () => false)) throw new Error(`${op.file} already exists`)
      writes.push({ abs, data: op.lines.join('\n') })
      report.push(`A ${op.file}`)
    } else if (op.kind === 'delete') {
      await fs.stat(abs).catch(() => { throw new Error(`${op.file} does not exist`) })
      writes.push({ abs, data: null })
      report.push(`D ${op.file}`)
    } else {
      const orig = await fs.readFile(abs, 'utf8').catch(() => { throw new Error(`${op.file} does not exist`) })
      const next = op.chunks.length ? applyChunks(orig, op.chunks, op.file) : orig
      const dest = op.moveTo ? safe(root, op.moveTo) : abs
      writes.push({ abs: dest, data: next, from: op.moveTo ? abs : undefined })
      report.push(`M ${op.file}${op.moveTo ? ` -> ${op.moveTo}` : ''}`)
    }
  }
  for (const w of writes) {
    if (w.data === null) await fs.rm(w.abs)
    else {
      await fs.mkdir(path.dirname(w.abs), { recursive: true })
      await fs.writeFile(w.abs, w.data)
      if (w.from) await fs.rm(w.from)
    }
  }
  return `Patch applied:\n${report.join('\n')}`
}
