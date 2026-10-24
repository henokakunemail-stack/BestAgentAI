// Built-in file/shell/web tools (Claude Code Read/Write/Edit/Glob/Grep/Bash/WebFetch equivalents).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'

const MAX_OUT = 30_000
const SKIP_DIRS = new Set(['node_modules', '.git'])
// (runId, abs path) -> mtimeMs at last read/write; guards blind overwrites and stale edits.
// Keyed per run so a subagent reading a file never makes it look "read" for its parent.
const readState = new Map<string, number>()
const rk = (runId: string, abs: string) => `${runId}|${abs}`

export function resolveInWorkspace(root: string, p: unknown, opts: { mustBeInside?: boolean } = {}): string {
  if (typeof p !== 'string' || !p) throw new Error('"path" is required')
  const abs = path.resolve(root, p)
  const rel = path.relative(root, abs)
  if (opts.mustBeInside && (rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new Error(`Path is outside the workspace root (${root}): ${p}`)
  }
  return abs
}

const trunc = (s: string, n = MAX_OUT) => (s.length > n ? s.slice(0, n) + `\n[... truncated ${s.length - n} chars]` : s)

export async function readFileTool(root: string, a: any, runId = ""): Promise<string> {
  const abs = resolveInWorkspace(root, a.path)
  const st = await fs.stat(abs)
  if (st.isDirectory()) return (await fs.readdir(abs)).join('\n')
  const buf = await fs.readFile(abs)
  if (buf.subarray(0, 8000).includes(0)) throw new Error('Binary file; cannot read as text.')
  readState.set(rk(runId, abs), st.mtimeMs)
  const lines = buf.toString('utf8').split(/\r?\n/)
  const offset = Math.max(1, Number(a.offset) || 1)
  const limit = Math.max(1, Number(a.limit) || 2000)
  const slice = lines.slice(offset - 1, offset - 1 + limit)
  const body = slice.map((l, i) => `${String(offset + i).padStart(6)}\t${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`).join('\n')
  const more = offset - 1 + limit < lines.length ? `\n[... ${lines.length - (offset - 1 + limit)} more lines; use offset/limit]` : ''
  return (body || '(empty file)') + more
}

async function assertFresh(abs: string, runId: string): Promise<void> {
  const known = readState.get(rk(runId, abs))
  if (known === undefined) throw new Error('File exists but was not read yet. Use read_file first.')
  if ((await fs.stat(abs)).mtimeMs !== known) throw new Error('File changed since it was read. Use read_file again.')
}

export async function writeFileTool(root: string, a: any, runId = ""): Promise<string> {
  const abs = resolveInWorkspace(root, a.path, { mustBeInside: true })
  if (typeof a.content !== 'string') throw new Error('"content" must be a string')
  const exists = await fs.stat(abs).then(() => true, () => false)
  if (exists) await assertFresh(abs, runId)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, a.content, 'utf8')
  readState.set(rk(runId, abs), (await fs.stat(abs)).mtimeMs)
  return `${exists ? 'Overwrote' : 'Created'} ${path.relative(root, abs)} (${a.content.length} chars)`
}

export async function editFileTool(root: string, a: any, runId = ""): Promise<string> {
  const abs = resolveInWorkspace(root, a.path, { mustBeInside: true })
  const oldS = String(a.old_string ?? '')
  const newS = String(a.new_string ?? '')
  if (!oldS) throw new Error('"old_string" must be non-empty')
  if (oldS === newS) throw new Error('old_string and new_string are identical')
  await assertFresh(abs, runId)
  const text = await fs.readFile(abs, 'utf8')
  const count = text.split(oldS).length - 1
  if (count === 0) throw new Error('old_string not found. Match whitespace exactly.')
  if (count > 1 && !a.replace_all) throw new Error(`old_string matches ${count} places. Add context to make it unique, or set replace_all.`)
  // split/join, not String.replace: "$&" in new_string must stay literal
  await fs.writeFile(abs, text.split(oldS).join(newS), 'utf8')
  readState.set(rk(runId, abs), (await fs.stat(abs)).mtimeMs)
  return `Edited ${path.relative(root, abs)} (${a.replace_all ? count : 1} replacement${count > 1 && a.replace_all ? 's' : ''})`
}

export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') { re += '(?:'; }
    else if (c === '}') re += ')'
    else if (c === ',' && /\{[^}]*$/.test(glob.slice(0, i))) re += '|'
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

async function* walk(dir: string, rel = ''): AsyncGenerator<{ abs: string; rel: string }> {
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name)
    } else if (e.isFile()) yield { abs: path.join(dir, e.name), rel: rel ? `${rel}/${e.name}` : e.name }
  }
}

export async function globTool(root: string, a: any): Promise<string> {
  const base = a.path ? resolveInWorkspace(root, a.path) : root
  const re = globToRegExp(String(a.pattern ?? ''))
  const hits: { rel: string; m: number }[] = []
  let scanned = 0
  for await (const f of walk(base)) {
    if (++scanned > 50_000) break
    if (re.test(f.rel)) hits.push({ rel: f.rel, m: (await fs.stat(f.abs)).mtimeMs })
  }
  hits.sort((x, y) => y.m - x.m)
  const out = hits.slice(0, 500).map((h) => h.rel)
  return out.length ? out.join('\n') + (hits.length > 500 ? `\n[... ${hits.length - 500} more]` : '') : 'No files matched.'
}

export async function grepTool(root: string, a: any): Promise<string> {
  const base = a.path ? resolveInWorkspace(root, a.path) : root
  let re: RegExp
  try { re = new RegExp(String(a.pattern ?? ''), a.ignore_case ? 'i' : '') } catch (e: any) { throw new Error(`Invalid regex: ${e.message}`) }
  const fileRe = a.glob ? globToRegExp(String(a.glob)) : null
  const limit = Math.max(1, Number(a.head_limit) || 250)
  const out: string[] = []
  const st = await fs.stat(base)
  const files = st.isFile() ? [{ abs: base, rel: path.basename(base) }] : walk(base)
  outer: for await (const f of files) {
    if (fileRe && !fileRe.test(f.rel) && !fileRe.test(path.basename(f.rel))) continue
    const s = await fs.stat(f.abs)
    if (s.size > 2_000_000) continue
    const buf = await fs.readFile(f.abs)
    if (buf.subarray(0, 8000).includes(0)) continue
    const lines = buf.toString('utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        out.push(`${f.rel}:${i + 1}:${lines[i].slice(0, 300)}`)
        if (out.length >= limit) break outer
      }
    }
  }
  return out.length ? out.join('\n') : 'No matches.'
}

export function bashTool(root: string, a: any, signal?: AbortSignal): Promise<string> {
  const command = String(a.command ?? '').trim()
  if (!command) return Promise.reject(new Error('"command" is required'))
  const timeout = Math.min(Math.max(Number(a.timeout_ms) || 120_000, 1000), 600_000)
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: root, shell: true, windowsHide: true })
    let out = ''
    let killed = ''
    const kill = (why: string) => {
      killed = why
      // shell:true on Windows spawns cmd.exe; taskkill /T takes the whole tree
      if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})
      else child.kill('SIGKILL')
    }
    const timer = setTimeout(() => kill(`timed out after ${timeout}ms`), timeout)
    const onAbort = () => kill('aborted by user')
    signal?.addEventListener('abort', onAbort, { once: true })
    const add = (d: Buffer) => { if (out.length < MAX_OUT * 4) out += d.toString('utf8') }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    child.on('error', (e) => { out += `\nspawn error: ${e.message}` })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const head = killed ? `[${killed}]\n` : ''
      resolve(trunc(`${head}${out}`.trimEnd() || '(no output)') + `\n[exit code ${code ?? 'null'}]`)
    })
  })
}

export async function webFetchTool(a: any, signal?: AbortSignal): Promise<string> {
  const url = new URL(String(a.url ?? ''))
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.')
  const res = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]), headers: { 'user-agent': 'AI-Desktop/1.0' } })
  const type = res.headers.get('content-type') ?? ''
  if (!/text|json|xml|javascript/i.test(type)) throw new Error(`Unsupported content-type: ${type || 'unknown'}`)
  let body = (await res.text()).slice(0, 1_000_000)
  if (/html/i.test(type)) {
    body = body
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n')
  }
  return `[${res.status}] ${url.href}\n` + trunc(body.trim())
}
