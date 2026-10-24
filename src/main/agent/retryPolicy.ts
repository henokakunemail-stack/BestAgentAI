// Pure retry / stop_reason decisions (no SDK or electron import) so scripts/selfcheck.mts can test them.

export const MAX_RETRIES = 5
export type ErrorClass = 'retry' | 'fatal' | 'overflow'

const NET_CODES = /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_\w+)$/
const NET_MSG = /fetch failed|socket hang up|terminated|premature close|aborted|network|stream idle|connection (error|closed|reset)/i
const OVERFLOW_MSG = /prompt is too long|context.{0,20}(length|window|limit)|exceeds? the (maximum|context)|too many tokens/i

export function classifyError(err: any): ErrorClass {
  const status = typeof err?.status === 'number' ? err.status : undefined
  const msg = String(err?.message ?? '')
  if (status === 400 && OVERFLOW_MSG.test(msg)) return 'overflow'
  if (status !== undefined) return status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600) ? 'retry' : 'fatal'
  // No HTTP status: a transport failure or a stream cut mid-flight.
  const code = String(err?.code ?? err?.cause?.code ?? '')
  if (NET_CODES.test(code)) return 'retry'
  if (err?.name === 'APIConnectionError' || err?.name === 'APIConnectionTimeoutError' || err?.name === 'StreamIdleError') return 'retry'
  return NET_MSG.test(msg) ? 'retry' : 'fatal'
}

function header(err: any, name: string): string | undefined {
  const h = err?.headers
  const v = typeof h?.get === 'function' ? h.get(name) : h?.[name]
  return typeof v === 'string' ? v : undefined
}

/** Wait before retry number `attempt` (0-based). Honors retry-after-ms / retry-after (seconds or HTTP date), capped at 60 s. */
export function retryDelayMs(attempt: number, err?: any, now = Date.now(), rand = Math.random): number {
  const ms = Number(header(err, 'retry-after-ms'))
  if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, 60_000)
  const ra = header(err, 'retry-after')
  if (ra !== undefined && ra.trim() !== '') {
    const secs = Number(ra)
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 60_000)
    const at = Date.parse(ra)
    if (Number.isFinite(at)) return Math.min(Math.max(at - now, 0), 60_000)
  }
  return Math.min(1000 * 2 ** attempt, 15_000) + Math.floor(rand() * 300)
}

export type StopAction = 'tools' | 'finish' | 'continue' | 'truncated_tool' | 'refusal' | 'resume'

export function stopAction(stopReason: string | null | undefined, hasToolUse: boolean): StopAction {
  switch (stopReason) {
    case 'tool_use':
      return 'tools'
    case 'max_tokens':
      return hasToolUse ? 'truncated_tool' : 'continue'
    case 'refusal':
      return 'refusal'
    case 'pause_turn':
      return 'resume'
    default:
      return 'finish' // end_turn, stop_sequence, null
  }
}

/** Backoff for MCP reconnects: 1 s, 2 s, 4 s ... capped at 30 s, plus jitter. */
export const backoffMs = (retries: number, rand = Math.random): number => Math.min(1000 * 2 ** retries, 30_000) + Math.floor(rand() * 300)
