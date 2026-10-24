import { app } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { readJsonFile, writeFileAtomic } from './atomic'
import { isSessionId } from '../ipc/validate'

const SESSIONS_DIR = join(app.getPath('userData'), 'sessions')

export interface StoredSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: any[]
}

type Summary = { id: string; title: string; updatedAt: number }

// In-memory index: built once by scanning the folder, then kept current by save/delete (no re-parse of every session per list).
let index: Map<string, Summary> | null = null

function pathFor(id: string): string {
  if (!isSessionId(id)) throw new Error(`invalid session id: ${String(id).slice(0, 40)}`)
  return join(SESSIONS_DIR, `${id}.json`)
}

export async function initSessionStorage(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true })
}

export async function listSessions(): Promise<Summary[]> {
  await initSessionStorage()
  if (!index) {
    const built = new Map<string, Summary>()
    for (const file of (await fs.readdir(SESSIONS_DIR)).filter((f) => f.endsWith('.json'))) {
      const { value } = await readJsonFile<StoredSession>(join(SESSIONS_DIR, file))
      if (value && isSessionId(value.id)) built.set(value.id, { id: value.id, title: value.title || 'Untitled Session', updatedAt: value.updatedAt || Date.now() })
    }
    index = built
  }
  return [...index.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** null = no such session. Throws when the file exists but neither it nor its .bak is readable, so callers never silently start over. */
export async function getSession(id: string): Promise<StoredSession | null> {
  await initSessionStorage()
  const { value, corrupt } = await readJsonFile<StoredSession>(pathFor(id))
  if (corrupt) throw new Error(`session ${id} is corrupted and has no usable backup: ${corrupt}`)
  return value ?? null
}

export async function saveSession(session: StoredSession): Promise<void> {
  await initSessionStorage()
  const filePath = pathFor(session.id)
  session.updatedAt = Date.now()
  await writeFileAtomic(filePath, JSON.stringify(session, null, 2))
  index?.set(session.id, { id: session.id, title: session.title || 'Untitled Session', updatedAt: session.updatedAt })
}

export async function createSession(): Promise<string> {
  const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  const session: StoredSession = {
    id,
    title: 'New Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  }
  await saveSession(session)
  return id
}

export async function deleteSession(id: string): Promise<boolean> {
  await initSessionStorage()
  const filePath = pathFor(id)
  index?.delete(id)
  await fs.unlink(`${filePath}.bak`).catch(() => {})
  try {
    await fs.unlink(filePath)
    return true
  } catch {
    return false
  }
}
