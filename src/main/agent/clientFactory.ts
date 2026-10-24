// Which endpoint the Anthropic SDK talks to: Anthropic directly, or a 9router gateway (/v1/messages, translates to OpenAI/Gemini).
// Pure on purpose (no electron import) so scripts/selfcheck.mts can load it.
import Anthropic from '@anthropic-ai/sdk'

export interface ProviderSettings {
  provider: 'anthropic' | '9router'
  anthropicApiKey: string
  routerBaseUrl: string
  routerApiKey: string
}

export interface ClientCfg {
  apiKey: string
  baseURL?: string
}

/** http(s) only; strips trailing slash and a trailing /v1 (the SDK appends /v1/messages itself). Throws on bad input. */
export function normalizeBaseUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error(`invalid URL: ${raw}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`url must be http(s): ${raw}`)
  return (u.origin + u.pathname).replace(/\/+$/, '').replace(/\/v1$/, '')
}

export const isLoopback = (url: string): boolean => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(new URL(url).hostname)

export function clientConfig(s: ProviderSettings, env: Record<string, string | undefined> = process.env): ClientCfg | { error: string } {
  if (s.provider === '9router') {
    try {
      // ponytail: a local 9router may run without keys, so an empty key gets a placeholder (the SDK refuses to send without one).
      return { apiKey: s.routerApiKey || 'no-key', baseURL: normalizeBaseUrl(s.routerBaseUrl) }
    } catch (e: any) {
      return { error: `9router: ${e.message}` }
    }
  }
  const apiKey = s.anthropicApiKey || env.ANTHROPIC_API_KEY
  return apiKey ? { apiKey } : { error: 'Anthropic API Key is not configured. Please open Settings to set your API Key.' }
}

// maxRetries 0: AgentRunner.streamWithRetry is the only retry layer (SDK retries would stack on top and repeat streamed text).
export const makeAnthropic = (cfg: ClientCfg): Anthropic => new Anthropic({ ...cfg, maxRetries: 0, timeout: 600_000 })

/** Model ids from an OpenAI-style GET /v1/models body ({data:[{id}]}); [] for anything else. */
export function parseModelIds(body: unknown): string[] {
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  return data.map((m) => (m as { id?: unknown })?.id).filter((x): x is string => typeof x === 'string')
}
