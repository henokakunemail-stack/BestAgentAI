// Codex two-phase memory: phase 1 extracts durable facts from a finished run,
// phase 2 consolidates into memories.json (upsert by key, newest wins, capped).
import Anthropic from '@anthropic-ai/sdk'
import { addMemory, getMemories, deleteMemory } from '../storage/memoryStore'

const MAX_MEMORIES = 50
const PROMPT = `Extract durable facts worth remembering across future sessions: user preferences, project conventions, stable decisions. Skip transient task details. NEVER include secrets, API keys, tokens or passwords.
Reply with ONLY a JSON array (max 5): [{"key":"short-slug","value":"one sentence"}]. Reply [] if nothing qualifies.`

export async function extractMemories(anthropic: Anthropic, model: string, messages: Anthropic.MessageParam[]): Promise<void> {
  const recent = messages.slice(-12)
  const res = await anthropic.messages.create({
    model,
    max_tokens: 600,
    system: PROMPT,
    messages: [...recent, { role: 'user', content: 'Extract memories now. JSON array only.' }]
  })
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return
  let items: Array<{ key: string; value: string }>
  try { items = JSON.parse(m[0]) } catch { return }
  for (const it of items.slice(0, 5)) {
    if (typeof it?.key === 'string' && typeof it?.value === 'string' && it.key && it.value && !/sk-[a-z0-9_-]{10,}|password|token/i.test(it.value)) {
      await addMemory(it.key.slice(0, 60), it.value.slice(0, 300))
    }
  }
  const all = await getMemories() // newest first
  for (const old of all.slice(MAX_MEMORIES)) await deleteMemory(old.id)
}

export async function memoryPromptBlock(): Promise<string> {
  const top = (await getMemories()).slice(0, 15)
  if (!top.length) return ''
  return `\n\n[Long-term memory - may be stale, verify before relying on it]\n${top.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`
}
