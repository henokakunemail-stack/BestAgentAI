// "@path" tokens in a prompt attach that workspace file: text -> <file> block, png/jpg/gif/webp -> image block.
// Tokens that do not resolve to a readable file inside the workspace stay plain text (emails, @mentions).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveInWorkspace } from './fileTools'

const MAX_TEXT = 256 * 1024
const MAX_IMAGE = 5 * 1024 * 1024
const IMAGE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const TOKEN = /(?:^|\s)@(?:"([^"]+)"|([^\s"']+))/g

export type UserContent = string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>

/** Text of a stored message content (string or blocks). */
export const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('') : ''

export async function buildUserContent(text: string, root: string): Promise<UserContent> {
  const refs = new Set<string>()
  for (const m of text.matchAll(TOKEN)) refs.add(m[1] ?? m[2])
  const blocks: Exclude<UserContent, string> = []
  for (const ref of refs) {
    try {
      const abs = resolveInWorkspace(root, ref, { mustBeInside: true })
      const st = await fs.stat(abs)
      if (!st.isFile()) continue
      const rel = path.relative(root, abs).replace(/\\/g, '/')
      const mime = IMAGE[path.extname(abs).toLowerCase()]
      if (mime) {
        if (st.size > MAX_IMAGE) continue
        blocks.push({ type: 'text', text: `<file path="${rel}" type="image">` }, { type: 'image', source: { type: 'base64', media_type: mime, data: (await fs.readFile(abs)).toString('base64') } })
      } else {
        const buf = await fs.readFile(abs)
        if (buf.subarray(0, 8000).includes(0)) continue // binary
        const body = buf.length > MAX_TEXT ? buf.subarray(0, MAX_TEXT).toString('utf8') + '\n[... truncated]' : buf.toString('utf8')
        blocks.push({ type: 'text', text: `<file path="${rel}">\n${body}\n</file>` })
      }
    } catch { /* not a file: leave as text */ }
  }
  return blocks.length ? [{ type: 'text', text }, ...blocks] : text
}
