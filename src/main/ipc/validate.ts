// Trust-boundary checks for IPC input. Pure: no electron import.

/** Shown to the renderer instead of a stored secret; sending it back means "keep the stored value". */
export const SECRET_MASK = '••••••••'

export const isSessionId = (v: unknown): v is string => typeof v === 'string' && /^session_[\w-]{1,64}$/.test(v)

/** Only https may leave the app through shell.openExternal (blocks file:, javascript:, custom protocols). */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:'
  } catch {
    return false
  }
}

const MODES = ['default', 'acceptEdits', 'plan', 'bypass', 'dontAsk'] as const
const PROVIDERS = ['anthropic', '9router'] as const
const str = (v: unknown) => typeof v === 'string'
const bool = (v: unknown) => typeof v === 'boolean'
const int = (min: number, max: number) => (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const oneOf = (list: readonly string[]) => (v: unknown) => typeof v === 'string' && list.includes(v)

const SETTINGS_RULES: Record<string, (v: unknown) => boolean> = {
  anthropicApiKey: str,
  routerApiKey: str,
  routerBaseUrl: str,
  model: (v) => str(v) && (v as string).length > 0 && (v as string).length <= 200,
  enableThinking: bool,
  enableRtkProxy: bool,
  enableSpeculativeExecution: bool,
  mcpConfigPath: str,
  permissionMode: oneOf(MODES),
  provider: oneOf(PROVIDERS),
  maxToolConcurrency: int(1, 32),
  maxTurns: int(1, 200),
  contextWindow: int(1000, 10_000_000),
  workspaceRoot: (v) => str(v) && (v as string).length > 0 && (v as string).length < 1024
}

const SECRET_KEYS = ['anthropicApiKey', 'routerApiKey']

/** Whitelist keys and types. Unknown keys are an error (not silently dropped) so drift is noticed. Masked secrets are dropped = keep stored. */
export function validateSettingsPatch(raw: unknown): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'settings must be an object' }
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    const rule = SETTINGS_RULES[k]
    if (!rule) return { ok: false, error: `unknown setting: ${k}` }
    if (!rule(v)) return { ok: false, error: `invalid value for ${k}` }
    if (SECRET_KEYS.includes(k) && v === SECRET_MASK) continue
    patch[k] = v
  }
  return { ok: true, patch }
}

/** Replace stored secrets with the mask (or '' when unset) before anything reaches the renderer. */
export function maskSecrets<T extends Record<string, any>>(s: T): T {
  const out: Record<string, any> = { ...s }
  for (const k of SECRET_KEYS) if (k in out) out[k] = out[k] ? SECRET_MASK : ''
  return out as T
}
