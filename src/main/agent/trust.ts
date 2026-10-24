// Per-project trust (Codex trust_level). Untrusted workspaces do not get their CLAUDE.md/AGENTS.md,
// .claude/{agents,skills,commands} loaded: those files are prompt-injection vectors. User-level dirs are unaffected.
import path from 'node:path'

const norm = (p: string): string => {
  const r = path.resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** Pure. A folder is trusted when it, or any parent folder, is in the list. */
export function isTrusted(list: string[], root: string): boolean {
  const r = norm(root)
  return list.some((t) => {
    const n = norm(t)
    return r === n || r.startsWith(n + path.sep)
  })
}

// ponytail: db.ts imports electron, so it is loaded lazily to keep isTrusted testable from scripts/selfcheck.mts.
const store = async () => import('../storage/db')

export async function getTrustList(): Promise<string[]> {
  const list = await (await store()).readJson<unknown>('trust.json', [])
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
}

export async function isWorkspaceTrusted(root: string): Promise<boolean> {
  return isTrusted(await getTrustList(), root)
}

export async function setWorkspaceTrusted(root: string, trusted: boolean): Promise<void> {
  const n = norm(root)
  const list = (await getTrustList()).filter((t) => norm(t) !== n)
  if (trusted) list.push(path.resolve(root))
  await (await store()).writeJson('trust.json', list)
}
