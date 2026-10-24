// File checkpoints + /rewind (Claude Code). Before write_file/edit_file/apply_patch touches a file, its old
// content is saved once per user turn. Rewinding to a turn restores every file touched since, and the caller
// truncates the conversation. Files changed through bash are NOT tracked.
// ponytail: turn = index of the user message in session.messages. Compaction renumbers messages, so a turn is only
// offered while messages[turn] still starts with the saved preview. Upgrade path: stable message ids.
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { parsePatch } from './applyPatch'
import { resolveInWorkspace } from './fileTools'

const MAX_FILE = 10 * 1024 * 1024
const KEEP_TURNS = 50

interface Manifest { preview: string; files: Record<string, string | null> } // abs path -> blob name, null = did not exist

export interface Turn { turn: number; preview: string; files: number }

const turnDir = (dir: string, sid: string, turn: number) => path.join(dir, sid, String(turn).padStart(6, '0'))
const blob = (abs: string) => createHash('sha1').update(abs).digest('hex')

// manifest read-modify-write must not interleave (parallel subagents)
let chain: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn)
  chain = p.catch(() => {})
  return p
}

const readManifest = async (d: string): Promise<Manifest | null> =>
  fs.readFile(path.join(d, 'manifest.json'), 'utf8').then((t) => JSON.parse(t) as Manifest, () => null)

export const checkpointDir = async (): Promise<string> => (await import('../storage/db')).getDataFilePath('checkpoints')

export const beginTurn = (dir: string, sid: string, turn: number, preview: string): Promise<void> =>
  serial(async () => {
    const d = turnDir(dir, sid, turn)
    await fs.mkdir(d, { recursive: true })
    await fs.writeFile(path.join(d, 'manifest.json'), JSON.stringify({ preview: preview.slice(0, 80), files: {} } satisfies Manifest))
    const all = (await fs.readdir(path.join(dir, sid))).sort()
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_TURNS))) await fs.rm(path.join(dir, sid, old), { recursive: true, force: true })
  })

/** Saves the old content of each file once per turn. Throws when it cannot: the caller must then NOT write. */
export const snapshot = (dir: string, sid: string, turn: number, absPaths: string[]): Promise<void> =>
  serial(async () => {
    const d = turnDir(dir, sid, turn)
    const m = (await readManifest(d)) ?? { preview: '', files: {} }
    await fs.mkdir(d, { recursive: true })
    for (const abs of absPaths) {
      if (abs in m.files) continue
      const st = await fs.stat(abs).catch(() => null)
      if (!st) m.files[abs] = null
      else {
        if (!st.isFile()) continue
        if (st.size > MAX_FILE) throw new Error(`${abs} is larger than ${MAX_FILE / 1024 / 1024} MB and cannot be checkpointed`)
        await fs.copyFile(abs, path.join(d, blob(abs)))
        m.files[abs] = blob(abs)
      }
    }
    await fs.writeFile(path.join(d, 'manifest.json'), JSON.stringify(m))
  })

export async function listTurns(dir: string, sid: string): Promise<Turn[]> {
  const names = (await fs.readdir(path.join(dir, sid)).catch(() => [] as string[])).sort()
  const out: Turn[] = []
  for (const n of names) {
    const m = await readManifest(path.join(dir, sid, n))
    if (m) out.push({ turn: Number(n), preview: m.preview, files: Object.keys(m.files).length })
  }
  return out
}

/** Restores the files of the given turns, newest first so the earliest snapshot wins, then forgets those turns.
 *  The caller passes only turns still valid for the current history (stale ones from before a compaction are skipped). */
export const restore = (dir: string, sid: string, turns: number[]): Promise<{ files: number }> =>
  serial(async () => {
    let files = 0
    for (const turn of [...turns].sort((a, b) => b - a)) {
      const d = turnDir(dir, sid, turn)
      const m = await readManifest(d)
      if (!m) continue
      for (const [abs, b] of Object.entries(m.files)) {
        if (b === null) await fs.rm(abs, { force: true })
        else {
          await fs.mkdir(path.dirname(abs), { recursive: true })
          await fs.copyFile(path.join(d, b), abs)
        }
        files++
      }
    }
    for (const t of turns) await fs.rm(turnDir(dir, sid, t), { recursive: true, force: true })
    return { files }
  })

export const dropSession = (dir: string, sid: string): Promise<void> =>
  serial(() => fs.rm(path.join(dir, sid), { recursive: true, force: true }))

/** Absolute paths a write tool is about to modify. Unparseable/outside-workspace input yields [] (the tool rejects it itself). */
export function writeTargets(tool: string, args: any, root: string): string[] {
  try {
    if (tool === 'write_file' || tool === 'edit_file') return [resolveInWorkspace(root, args?.path, { mustBeInside: true })]
    if (tool === 'apply_patch') {
      const paths = parsePatch(String(args?.patch ?? '')).flatMap((op) => [op.file, ...(op.kind === 'update' && op.moveTo ? [op.moveTo] : [])])
      return paths.map((p) => resolveInWorkspace(root, p, { mustBeInside: true }))
    }
  } catch {
    /* tool reports its own error */
  }
  return []
}
