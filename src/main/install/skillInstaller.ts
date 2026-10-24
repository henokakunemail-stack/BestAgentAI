// Install skills (and read .mcp.json) from a GitHub repo: shallow `git clone` into a temp dir, preview, then copy after the user approves.
// Nothing from the repo is executed; scripts are only copied (and flagged in the preview).
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { githubCloneUrl, isInside, isSafeSkillName, parseGithubUrl, type GithubRef } from './githubSource'
import { parseFrontmatter } from '../agent/skillsLoader'

const run = promisify(execFile)

export const MAX_FILES = 200
export const MAX_BYTES = 5 * 1024 * 1024
const TOKEN_TTL_MS = 5 * 60_000
const SCRIPT_EXT = /\.(sh|bash|ps1|bat|cmd|py|js|mjs|cjs|ts|rb|pl)$/i

export interface SkillCandidate {
  name: string
  description: string
  relPath: string
  files: number
  bytes: number
  hasScripts: boolean
  exists: boolean
  /** first part of SKILL.md so the user reads it before approving */
  preview: string
}

export interface SkillInspect {
  token: string
  url: string
  sha: string
  candidates: SkillCandidate[]
}

interface Pending {
  dir: string
  url: string
  ref?: string
  sha: string
  candidates: Map<string, string> // name -> abs dir
  timer: NodeJS.Timeout
}

const pending = new Map<string, Pending>()

function userSkillsDir(): string {
  return join(os.homedir(), '.claude', 'skills')
}

function targetDir(scope: 'user' | 'workspace', workspaceRoot?: string): string {
  if (scope === 'user') return userSkillsDir()
  if (!workspaceRoot) throw new Error('workspace is not trusted or not set')
  return join(workspaceRoot, '.ai-desktop', 'skills')
}

async function gitOut(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    return stdout.trim()
  } catch (e: any) {
    if (e?.code === 'ENOENT') throw new Error('git not found in PATH (install Git for Windows)')
    throw new Error(`git ${args[0]} failed: ${String(e?.stderr || e?.message || e).trim().split('\n').pop()}`)
  }
}

/** Shallow clone into a fresh temp dir. Test hook: AI_INSTALL_ALLOW_FILE=1 also accepts an absolute local path. */
async function cloneTo(source: string): Promise<{ dir: string; repoDir: string; ref?: string; subdir?: string; url: string; sha: string }> {
  let g: GithubRef | null = parseGithubUrl(source)
  const local = !g && process.env.AI_INSTALL_ALLOW_FILE === '1' && /^[a-zA-Z]:[\\/]|^\//.test(source)
  if (!g && !local) throw new Error('only github.com repositories are supported (https://github.com/owner/repo[/tree/branch/path])')
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'ai-desktop-install-'))
  const repoDir = join(dir, 'repo')
  try {
    const url = local ? source : githubCloneUrl(g!)
    const args = ['clone', '--depth', '1', '--quiet', '--no-tags', '-c', 'core.symlinks=false']
    if (g?.ref) args.push('--branch', g.ref)
    await gitOut([...args, '--', url, repoDir])
    const sha = await gitOut(['rev-parse', 'HEAD'], repoDir)
    return { dir, repoDir, ref: g?.ref, subdir: g?.subdir, url: local ? source : `https://github.com/${g!.owner}/${g!.repo}`, sha }
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    throw e
  }
}

interface Walk { files: string[]; bytes: number }

/** Regular files under `root` (no .git, no symlinks). Throws when over the limits. */
async function walk(root: string): Promise<Walk> {
  const out: Walk = { files: [], bytes: 0 }
  const go = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const p = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) { await go(p); continue }
      if (!e.isFile()) continue
      const st = await fs.stat(p)
      out.files.push(p)
      out.bytes += st.size
      if (out.files.length > MAX_FILES) throw new Error(`skill has more than ${MAX_FILES} files`)
      if (out.bytes > MAX_BYTES) throw new Error(`skill is larger than ${MAX_BYTES / 1024 / 1024} MB`)
    }
  }
  await go(root)
  return out
}

const hasSkillMd = (d: string): Promise<boolean> => fs.stat(join(d, 'SKILL.md')).then((s) => s.isFile(), () => false)

async function childDirs(d: string): Promise<string[]> {
  const es = await fs.readdir(d, { withFileTypes: true }).catch(() => [])
  return es.filter((e) => e.isDirectory() && e.name !== '.git').map((e) => join(d, e.name))
}

async function findSkillDirs(repoDir: string, subdir?: string): Promise<string[]> {
  if (subdir) {
    const base = join(repoDir, subdir)
    if (!isInside(repoDir, base)) throw new Error('bad path')
    if (await hasSkillMd(base)) return [base]
    const found: string[] = []
    for (const c of await childDirs(base)) if (await hasSkillMd(c)) found.push(c)
    return found
  }
  if (await hasSkillMd(repoDir)) return [repoDir]
  const found: string[] = []
  for (const root of ['skills', '.claude/skills', '.codex/skills']) {
    for (const c of await childDirs(join(repoDir, root))) if (await hasSkillMd(c)) found.push(c)
  }
  return found
}

export async function inspectSkillSource(source: string, workspaceRoot?: string): Promise<SkillInspect> {
  const c = await cloneTo(source)
  try {
    const dirs = await findSkillDirs(c.repoDir, c.subdir)
    if (!dirs.length) throw new Error('no SKILL.md found (looked in ., skills/*, .claude/skills/*, .codex/skills/*)')
    const candidates: SkillCandidate[] = []
    const map = new Map<string, string>()
    const existing = new Set<string>()
    for (const t of workspaceRoot ? [userSkillsDir(), targetDir('workspace', workspaceRoot)] : [userSkillsDir()]) {
      for (const d of await childDirs(t)) existing.add(d.slice(t.length + 1))
    }
    for (const d of dirs) {
      const raw = await fs.readFile(join(d, 'SKILL.md'), 'utf-8')
      const { meta } = parseFrontmatter(raw)
      const fallback = d === c.repoDir ? (source.split(/[\\/]/).filter(Boolean).pop() ?? '').replace(/\.git$/, '') : d.split(/[\\/]/).pop()!
      const name = meta.name || fallback
      if (!isSafeSkillName(name)) throw new Error(`skill name "${name}" is not allowed (letters, digits, _ . - only)`)
      if (map.has(name)) continue
      const w = await walk(d)
      map.set(name, d)
      candidates.push({
        name,
        description: meta.description || '',
        relPath: d === c.repoDir ? '.' : d.slice(c.repoDir.length + 1).replace(/\\/g, '/'),
        files: w.files.length,
        bytes: w.bytes,
        hasScripts: w.files.some((f) => SCRIPT_EXT.test(f)),
        exists: existing.has(name),
        preview: raw.slice(0, 4000)
      })
    }
    const token = randomBytes(16).toString('hex')
    const timer = setTimeout(() => void discard(token), TOKEN_TTL_MS)
    timer.unref?.()
    pending.set(token, { dir: c.dir, url: c.url, ref: c.ref, sha: c.sha, candidates: map, timer })
    return { token, url: c.url, sha: c.sha, candidates }
  } catch (e) {
    await fs.rm(c.dir, { recursive: true, force: true }).catch(() => {})
    throw e
  }
}

export async function discard(token: string): Promise<void> {
  const p = pending.get(token)
  if (!p) return
  pending.delete(token)
  clearTimeout(p.timer)
  await fs.rm(p.dir, { recursive: true, force: true }).catch(() => {})
}

/** Remove every pending clone (app quit). */
export async function discardAll(): Promise<void> {
  await Promise.all([...pending.keys()].map(discard))
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true })
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (e.name === '.git' || e.isSymbolicLink()) continue
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) await copyDir(s, d)
    else if (e.isFile()) await fs.copyFile(s, d)
  }
}

/** Copies the approved candidates. The token is consumed whatever the outcome. Returns installed names. */
export async function installSkills(token: string, names: string[], scope: 'user' | 'workspace', overwrite: boolean, workspaceRoot?: string): Promise<string[]> {
  const p = pending.get(token)
  if (!p) throw new Error('install session expired, inspect the repository again')
  try {
    const base = targetDir(scope, workspaceRoot)
    await fs.mkdir(base, { recursive: true })
    const done: string[] = []
    for (const name of names) {
      const src = p.candidates.get(name)
      if (!src || !isSafeSkillName(name)) throw new Error(`unknown skill "${name}"`)
      const dst = join(base, name)
      if (!isInside(base, dst)) throw new Error('bad target path')
      const exists = await fs.stat(dst).then(() => true, () => false)
      if (exists && !overwrite) throw new Error(`skill "${name}" already exists`)
      if (exists && !(await fs.stat(join(dst, '.source.json')).then(() => true, () => false))) {
        throw new Error(`skill "${name}" was not installed by this app; remove it by hand first`)
      }
      const stage = `${dst}.installing-${randomBytes(4).toString('hex')}`
      try {
        await copyDir(src, stage)
        await fs.writeFile(join(stage, '.source.json'), JSON.stringify({ url: p.url, ref: p.ref, sha: p.sha, installedAt: new Date().toISOString() }, null, 2), 'utf-8')
        if (exists) await fs.rm(dst, { recursive: true, force: true })
        await fs.rename(stage, dst)
      } catch (e) {
        await fs.rm(stage, { recursive: true, force: true }).catch(() => {})
        throw e
      }
      done.push(name)
    }
    return done
  } finally {
    await discard(token)
  }
}

/** Only skills this app installed (they carry .source.json) can be removed. */
export async function removeSkill(name: string, workspaceRoot?: string): Promise<boolean> {
  if (!isSafeSkillName(name)) throw new Error('bad skill name')
  for (const base of workspaceRoot ? [targetDir('workspace', workspaceRoot), userSkillsDir()] : [userSkillsDir()]) {
    const d = join(base, name)
    if (await fs.stat(join(d, '.source.json')).then(() => true, () => false)) {
      await fs.rm(d, { recursive: true, force: true })
      return true
    }
  }
  return false
}

/** Read .mcp.json (or mcp.json) from a repo so the user can review it. Never runs anything. */
export async function inspectMcpSource(source: string): Promise<{ url: string; sha: string; snippet: string | null; readme: string | null }> {
  const c = await cloneTo(source)
  try {
    const root = c.subdir ? join(c.repoDir, c.subdir) : c.repoDir
    if (!isInside(c.repoDir, root) && root !== c.repoDir) throw new Error('bad path')
    const read = async (n: string): Promise<string | null> => {
      const p = join(root, n)
      const st = await fs.lstat(p).catch(() => null)
      return st?.isFile() && st.size < 256 * 1024 ? fs.readFile(p, 'utf-8') : null
    }
    const snippet = (await read('.mcp.json')) ?? (await read('mcp.json'))
    const readme = snippet ? null : ((await read('README.md')) ?? (await read('readme.md')))?.slice(0, 20_000) ?? null
    return { url: c.url, sha: c.sha, snippet, readme }
  } finally {
    await fs.rm(c.dir, { recursive: true, force: true }).catch(() => {})
  }
}
