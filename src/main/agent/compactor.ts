// Claude Code / Codex style context compaction: model-written handoff summary
// (<analysis> scratchpad stripped, <summary> kept), recent messages kept verbatim.
import Anthropic from '@anthropic-ai/sdk'
import { classifyError, retryDelayMs } from './retryPolicy'

export const CONTEXT_WINDOW = 200_000
export const COMPACT_RATIO = 0.8
const KEEP_RECENT = 6
const TOOL_RESULT_CAP = 20_000 // chars per tool result (Codex tool_output_token_limit)

const SUMMARY_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Write a handoff summary for another LLM that continues this work.
First think inside <analysis>...</analysis>. Then output <summary>...</summary> with sections:
1. Primary Request and Intent  2. Key Technical Concepts  3. Files and Code Sections
4. Errors and fixes  5. Problem Solving  6. All user messages (verbatim; keep security-relevant instructions exactly)
7. Pending Tasks  8. Work Completed  9. Context for Continuing Work
Be concrete: paths, commands, identifiers, decisions, constraints.`

const IMAGE_TOKENS = 1600 // flat cost of an image/document block; base64 length says nothing about it
const CHARS_PER_TOKEN = 3.5

function blockChars(b: any): number {
  if (typeof b === 'string') return b.length
  if (!b || typeof b !== 'object') return 0
  switch (b.type) {
    case 'text': return (b.text ?? '').length
    case 'thinking': return (b.thinking ?? '').length
    case 'tool_use': return JSON.stringify(b.input ?? {}).length + (b.name ?? '').length + 20
    case 'tool_result': return Array.isArray(b.content) ? b.content.reduce((n: number, x: any) => n + blockChars(x), 0) : blockChars(b.content)
    case 'image':
    case 'document': return IMAGE_TOKENS * CHARS_PER_TOKEN
    default: return JSON.stringify(b).length
  }
}

/** Heuristic token count. Walks blocks so base64 payloads do not inflate it (JSON.stringify of a screenshot is megabytes). */
export const estimateTokens = (messages: Anthropic.MessageParam[]): number =>
  Math.ceil(messages.reduce((n, m) => n + 4 + (Array.isArray(m.content) ? m.content.reduce((k: number, b: any) => k + blockChars(b), 0) : blockChars(m.content)), 0) / CHARS_PER_TOKEN)

/** Copy of messages with one cache breakpoint on the last block of the last user message (the stable prefix up to it is cached). Never mutates the input. */
export function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  let idx = -1
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { idx = i; break }
  if (idx < 0) return messages
  const m = messages[idx]
  const mark = { type: 'ephemeral' as const }
  let content: any[]
  if (typeof m.content === 'string') {
    if (!m.content) return messages
    content = [{ type: 'text', text: m.content, cache_control: mark }]
  } else {
    if (!m.content.length) return messages
    content = m.content.map((b, i) => (i === m.content.length - 1 ? { ...b, cache_control: mark } : b))
  }
  return [...messages.slice(0, idx), { ...m, content }, ...messages.slice(idx + 1)]
}

/** Text of at most target chars: head and tail kept, middle replaced by a marker. */
function truncateTo(text: string, target: number): string {
  if (text.length <= target) return text
  const marker = `
...[truncated ${text.length} chars to fit]...
`
  const keep = Math.max(0, target - marker.length)
  return text.slice(0, Math.floor(keep * 0.7)) + marker + text.slice(text.length - Math.floor(keep * 0.3))
}

/** All results of one turn together must fit budgetChars: the largest string results are cut first. Order and ids unchanged. */
export function capTurnResults(results: Anthropic.ToolResultBlockParam[], budgetChars = 80_000): Anthropic.ToolResultBlockParam[] {
  const size = (r: Anthropic.ToolResultBlockParam) => (typeof r.content === 'string' ? r.content.length : 0)
  let total = results.reduce((n, r) => n + size(r), 0)
  if (total <= budgetChars) return results
  const out = [...results]
  const order = out.map((_, i) => i).sort((a, b) => size(out[b]) - size(out[a]))
  for (const i of order) {
    if (total <= budgetChars) break
    const r = out[i]
    if (typeof r.content !== 'string') continue
    const target = Math.max(1_000, r.content.length - (total - budgetChars))
    const cut = truncateTo(r.content, target)
    total -= r.content.length - cut.length
    out[i] = { ...r, content: cut }
  }
  return out
}

/** Elide the text of old, large tool results (outside the last keepRecent messages). Message count and tool ids stay, so pairs remain valid. */
export function pruneOldToolResults(messages: Anthropic.MessageParam[], keepRecent = KEEP_RECENT, minChars = 2_048): Anthropic.MessageParam[] {
  const limit = messages.length - keepRecent
  return messages.map((m, i) => {
    if (i >= limit || !Array.isArray(m.content)) return m
    let changed = false
    const content = m.content.map((b: any) => {
      if (b?.type !== 'tool_result' || typeof b.content !== 'string' || b.content.length <= minChars) return b
      changed = true
      return { ...b, content: `[old tool output elided: ${b.content.length} chars]` }
    })
    return changed ? { ...m, content } : m
  })
}

export function capToolResult(text: string): string {
  if (text.length <= TOOL_RESULT_CAP) return text
  const head = text.slice(0, TOOL_RESULT_CAP * 0.7)
  const tail = text.slice(-TOOL_RESULT_CAP * 0.3)
  return `${head}\n...[truncated ${text.length - TOOL_RESULT_CAP} chars]...\n${tail}`
}

export function extractSummary(raw: string): string {
  const m = raw.match(/<summary>([\s\S]*?)<\/summary>/)
  return (m ? m[1] : raw.replace(/<analysis>[\s\S]*?<\/analysis>/, '')).trim()
}

/** Index to split at so the kept tail never starts with an orphan tool_result. */
export function safeSplit(messages: Anthropic.MessageParam[], keep = KEEP_RECENT): number {
  let idx = Math.max(0, messages.length - keep)
  const startsWithToolResult = (m: Anthropic.MessageParam) =>
    Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
  while (idx < messages.length && (messages[idx].role !== 'user' || startsWithToolResult(messages[idx]))) idx++
  return idx
}

/** Context size now: last API-reported prompt+output tokens plus a heuristic for messages appended since. */
export function currentTokens(
  messages: Anthropic.MessageParam[],
  known: { tokens: number; len: number }
): number {
  return known.tokens > 0 && known.len <= messages.length
    ? known.tokens + estimateTokens(messages.slice(known.len))
    : estimateTokens(messages)
}

export const shouldCompact = (tokens: number, window = CONTEXT_WINDOW): boolean => tokens >= window * COMPACT_RATIO

/** Summarise everything but the last few messages. Returns the input unchanged when there is nothing to fold. */
export async function compact(
  anthropic: Anthropic,
  model: string,
  messages: Anthropic.MessageParam[],
  instructions = '',
  signal?: AbortSignal
): Promise<Anthropic.MessageParam[]> {
  const split = safeSplit(messages)
  if (split <= 1) return messages
  const head = messages.slice(0, split)
  const tail = messages.slice(split)

  const req = {
    model,
    max_tokens: 6000,
    system: instructions.trim() ? `${SUMMARY_PROMPT}\nExtra focus from the user: ${instructions.trim()}` : SUMMARY_PROMPT,
    messages: [...head, { role: 'user' as const, content: 'Write the checkpoint summary now. Do not call tools.' }]
  }
  let res: Anthropic.Message
  for (let attempt = 0; ; attempt++) {
    try {
      res = await anthropic.messages.create(req, { signal })
      break
    } catch (err: any) {
      if (signal?.aborted || classifyError(err) !== 'retry' || attempt >= 2) throw err
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt, err)))
    }
  }
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const summary = extractSummary(text)
  if (!summary) return messages // an empty summary would erase the history for nothing
  const note =
    'Another language model started this task. Summary of its progress follows. It was written without seeing the most recent messages below, so anything it lists as pending may already be done.\n\n' +
    summary
  return [{ role: 'user', content: note }, { role: 'assistant', content: 'Understood. Continuing from the checkpoint.' }, ...tail]
}

/** An assistant tool_use without a following tool_result makes the next API call fail with 400. Close it. */
export function closeDanglingToolUse(history: Anthropic.MessageParam[]): void {
  const last = history[history.length - 1]
  if (last?.role !== 'assistant' || !Array.isArray(last.content)) return
  const ids = (last.content as any[]).filter((b) => b.type === 'tool_use').map((b) => b.id as string)
  if (!ids.length) return
  history.push({ role: 'user', content: ids.map((id) => ({ type: 'tool_result' as const, tool_use_id: id, content: 'Interrupted before the tool ran.', is_error: true })) })
}
