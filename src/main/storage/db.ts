import { app } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { readJsonFile, writeFileAtomic, updateJsonFile } from './atomic'

const DATA_DIR = join(app.getPath('userData'), 'data')

export async function initDatabase(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

export function getDataFilePath(fileName: string): string {
  return join(DATA_DIR, fileName)
}

/** Falls back to the last good `.bak` when the file is corrupt; defaults only when neither parses. */
export async function readJson<T>(fileName: string, defaultValue: T): Promise<T> {
  await initDatabase()
  const { value, corrupt } = await readJsonFile<T>(getDataFilePath(fileName))
  if (corrupt) console.warn(`[db] ${fileName} is not valid JSON and has no usable backup, using defaults: ${corrupt}`)
  return value ?? defaultValue
}

/** Atomic (temp + rename), serialized per file, keeps the previous version as `.bak`. */
export async function writeJson<T>(fileName: string, data: T): Promise<void> {
  await initDatabase()
  await writeFileAtomic(getDataFilePath(fileName), JSON.stringify(data, null, 2))
}

/** Locked read-modify-write: concurrent updates to one file cannot lose each other's changes. */
export async function updateJson<T>(fileName: string, defaultValue: T, fn: (cur: T) => T | Promise<T>): Promise<T> {
  await initDatabase()
  return updateJsonFile(getDataFilePath(fileName), defaultValue, fn)
}
