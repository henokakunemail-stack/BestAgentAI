// Pure helpers for installing skills / MCP servers from GitHub. No electron or fs import so scripts/selfcheck.mts can test them.
import { isAbsolute, relative, resolve } from 'node:path'
import { transportSpec, type McpServerConfig } from '../mcp/mcpConfig'

export interface GithubRef {
  owner: string
  repo: string
  ref?: string
  subdir?: string
}

const SEG = /^[\w.-]+$/

/** `https://github.com/o/r[/tree/<ref>/<path>]`, `github.com/o/r`, or `o/r[/path]`. null = not a safe GitHub source. */
export function parseGithubUrl(input: string): GithubRef | null {
  let s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  if (!s || /\s/.test(s)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    let u: URL
    try { u = new URL(s) } catch { return null }
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.port) return null
    s = u.pathname.slice(1)
  } else if (s.toLowerCase().startsWith('github.com/')) {
    s = s.slice('github.com/'.length)
  }
  const parts = s.split('/').filter((p) => p !== '')
  if (parts.length < 2) return null
  if (parts.some((p) => p === '.' || p === '..' || !SEG.test(p))) return null
  const [owner, repo, ...rest] = parts
  if (rest.length === 0) return { owner, repo }
  if (rest[0] === 'tree' || rest[0] === 'blob') {
    // ponytail: a branch name containing "/" is read as ref=first segment + subdir; pass the subdir explicitly via owner/repo/path for those.
    if (rest.length < 2) return null
    const sub = rest.slice(2).join('/')
    return { owner, repo, ref: rest[1], ...(sub ? { subdir: sub } : {}) }
  }
  return { owner, repo, subdir: rest.join('/') }
}

export const githubCloneUrl = (g: GithubRef): string => `https://github.com/${g.owner}/${g.repo}.git`

export function isSafeSkillName(n: string): boolean {
  return /^[\w][\w.-]{0,63}$/.test(n) && n !== '.' && n !== '..'
}

/** True when `target` resolves to a path strictly under `base` (blocks ../ and absolute escapes). */
export function isInside(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const looksLikeServer = (v: unknown): boolean => isObj(v) && (typeof v.command === 'string' || typeof v.url === 'string')

function cleanServer(v: Record<string, unknown>): McpServerConfig {
  const strMap = (m: unknown): Record<string, string> | undefined =>
    isObj(m) ? Object.fromEntries(Object.entries(m).map(([k, x]) => [k, String(x)])) : undefined
  const c: McpServerConfig = {}
  if (typeof v.command === 'string') c.command = v.command
  if (Array.isArray(v.args)) c.args = v.args.map(String)
  const env = strMap(v.env)
  if (env) c.env = env
  if (v.type === 'stdio' || v.type === 'http' || v.type === 'sse') c.type = v.type
  else if (v.type === 'streamable-http' || v.type === 'streamableHttp') c.type = 'http'
  if (typeof v.url === 'string') c.url = v.url
  const headers = strMap(v.headers)
  if (headers) c.headers = headers
  return c
}

/**
 * Pasted text -> named server configs. Accepts `{ "mcpServers": {...} }`, a bare `{ "name": {...} }` map,
 * or one config `{ "command": ... }` (named by `fallbackName`). Throws a readable error; every entry is checked with transportSpec.
 */
export function parseMcpSnippet(text: string, fallbackName = 'server'): Record<string, McpServerConfig> {
  let json: unknown
  try { json = JSON.parse(text.trim()) } catch (e) { throw new Error(`not valid JSON: ${(e as Error).message}`) }
  if (!isObj(json)) throw new Error('expected a JSON object')
  let entries: Record<string, unknown>
  if (isObj(json.mcpServers)) entries = json.mcpServers
  else if (looksLikeServer(json)) entries = { [fallbackName]: json }
  else entries = json
  const out: Record<string, McpServerConfig> = {}
  for (const [name, v] of Object.entries(entries)) {
    if (!isSafeSkillName(name)) throw new Error(`bad server name "${name}" (letters, digits, _ . - only)`)
    if (!isObj(v)) throw new Error(`"${name}": expected an object`)
    const conf = cleanServer(v)
    try { transportSpec(conf) } catch (e) { throw new Error(`"${name}": ${(e as Error).message}`) }
    out[name] = conf
  }
  if (!Object.keys(out).length) throw new Error('no servers found')
  return out
}

/** Key-order independent JSON, to tell whether a server config really changed. */
export function stableJson(v: unknown): string {
  const norm = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(norm) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm(x[k])])) : x
  return JSON.stringify(norm(v))
}

/** Config for display: env / header values never leave the main process. */
export function maskConfig(c: McpServerConfig): { command?: string; args?: string[]; url?: string; type?: string; env: string[]; headers: string[] } {
  return { command: c.command, args: c.args, url: c.url, type: c.type, env: Object.keys(c.env ?? {}), headers: Object.keys(c.headers ?? {}) }
}
