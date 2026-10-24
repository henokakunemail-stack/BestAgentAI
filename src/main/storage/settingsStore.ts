import { safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { readJson, updateJson, getDataFilePath } from './db'

export interface UserSettings {
  anthropicApiKey: string
  model: string
  enableThinking: boolean
  enableRtkProxy: boolean
  enableSpeculativeExecution: boolean
  mcpConfigPath: string
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypass' | 'dontAsk'
  maxToolConcurrency: number
  maxTurns: number
  workspaceRoot: string
  /** Model context window in tokens; auto-compaction triggers at 80% (Claude: contextWindowByModel / autoCompactWindow). */
  contextWindow: number
  /** 'anthropic' = direct API key; '9router' = local gateway for Claude/ChatGPT/Antigravity accounts. */
  provider: 'anthropic' | '9router'
  routerBaseUrl: string
  routerApiKey: string
}

const FILE_NAME = 'settings.json'

const DEFAULT_SETTINGS: UserSettings = {
  anthropicApiKey: '',
  model: 'claude-opus-5-5',
  enableThinking: true,
  enableRtkProxy: true,
  enableSpeculativeExecution: true,
  mcpConfigPath: '',
  permissionMode: 'default',
  maxToolConcurrency: 10,
  maxTurns: 25,
  workspaceRoot: process.cwd(),
  contextWindow: 200_000,
  provider: 'anthropic',
  routerBaseUrl: 'http://localhost:20128',
  routerApiKey: ''
}

// API keys are encrypted at rest with the OS keychain (DPAPI on Windows). Stored form: "enc:v1:<base64>".
// ponytail: falls back to plaintext when safeStorage is unavailable (e.g. headless Linux); add a warning in the UI if that matters.
const SECRET_FIELDS = ['anthropicApiKey', 'routerApiKey'] as const
const PREFIX = 'enc:v1:'

function seal(v: string): string {
  if (!v || v.startsWith(PREFIX) || !safeStorage.isEncryptionAvailable()) return v
  return PREFIX + safeStorage.encryptString(v).toString('base64')
}

function unseal(v: string): string {
  if (!v.startsWith(PREFIX)) return v // legacy plaintext, re-sealed on next save
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(PREFIX.length), 'base64'))
  } catch {
    return '' // wrong keychain (copied profile): treat as unset so the user is asked again
  }
}

const mapSecrets = (s: UserSettings, f: (v: string) => string): UserSettings => {
  const out = { ...s }
  for (const k of SECRET_FIELDS) out[k] = f(out[k] ?? '')
  return out
}

/** Decrypted view: main process only. Anything sent to the renderer must go through maskSecrets. */
export async function getSettings(): Promise<UserSettings> {
  const current = await readJson<Partial<UserSettings>>(FILE_NAME, {})
  return mapSecrets({ ...DEFAULT_SETTINGS, ...current }, unseal)
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  let saved!: UserSettings
  let legacy = false
  await updateJson<Partial<UserSettings>>(FILE_NAME, {}, (raw) => {
    legacy = SECRET_FIELDS.some((k) => !!raw[k] && !String(raw[k]).startsWith(PREFIX))
    const updated = mapSecrets({ ...DEFAULT_SETTINGS, ...mapSecrets({ ...DEFAULT_SETTINGS, ...raw }, unseal), ...settings }, (v) => v)
    saved = updated
    return mapSecrets(updated, seal) // also migrates legacy plaintext keys on any save
  })
  // The automatic .bak of a migrating save is the old plaintext file: drop it so no readable copy of the key stays on disk.
  if (legacy && safeStorage.isEncryptionAvailable()) await fs.unlink(`${getDataFilePath(FILE_NAME)}.bak`).catch(() => {})
  return saved
}
