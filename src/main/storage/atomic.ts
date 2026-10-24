import { promises as fs } from 'node:fs'

// Pure fs helpers (no electron import) so selfcheck can exercise them.

const chains = new Map<string, Promise<unknown>>()

/** Serialize async work per key: read-modify-write on the same file can no longer interleave. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).then(fn)
  const tail = next.catch(() => {})
  chains.set(key, tail)
  void tail.then(() => chains.get(key) === tail && chains.delete(key))
  return next
}

// ponytail: no fsync, so a power cut (not an app crash) can still lose the newest write; add fh.sync() if that matters.
async function writeUnlocked(path: string, text: string, backup: boolean): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(tmp, text, 'utf-8')
    if (backup) await fs.copyFile(path, `${path}.bak`).catch(() => {}) // keep last good copy
    await fs.rename(tmp, path)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

export const writeFileAtomic = (path: string, text: string, backup = true): Promise<void> =>
  withLock(path, () => writeUnlocked(path, text, backup))

/** undefined = file missing and no usable backup; throws never. `corrupt` set when a file existed but neither it nor .bak parsed. */
export async function readJsonFile<T>(path: string): Promise<{ value?: T; corrupt?: string }> {
  let corrupt: string | undefined
  for (const p of [path, `${path}.bak`]) {
    let raw: string
    try {
      raw = await fs.readFile(p, 'utf-8')
    } catch {
      continue
    }
    try {
      return { value: JSON.parse(raw) as T }
    } catch (e) {
      corrupt ??= (e as Error).message
    }
  }
  return corrupt ? { corrupt } : {}
}

/** Read, transform and write under one lock. fn returns the new value. */
export function updateJsonFile<T>(path: string, fallback: T, fn: (cur: T) => T | Promise<T>, backup = true): Promise<T> {
  return withLock(path, async () => {
    const { value } = await readJsonFile<T>(path)
    const next = await fn(value ?? fallback)
    await writeUnlocked(path, JSON.stringify(next, null, 2), backup)
    return next
  })
}
