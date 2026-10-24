// Slash commands: built-ins (/compact /clear /model /plan /cost /skills) and custom ones from
// <workspace>/.claude/commands/*.md and ~/.claude/commands/*.md (body is the prompt; $ARGUMENTS is substituted).
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { parseFrontmatter } from './skillsLoader'

export const BUILTIN_DESCRIPTIONS = {
  compact: 'Summarize the conversation to free context. Optional focus text.',
  clear: 'Clear this conversation.',
  rewind: 'List checkpoints, or /rewind <n> to undo the last n prompts: restores files edited by write/edit/patch tools and drops the messages.',
  model: 'Show or set the model: /model <id>',
  plan: 'Switch to plan mode (read-only until you approve a plan).',
  permissions: 'Show or set permission mode: /permissions default|acceptEdits|plan|bypass|dontAsk',
  cost: 'Show token usage and estimated cost for this session.',
  skills: 'List available skills.',
  agents: 'List available subagents.',
  mcp: 'Show MCP server status.'
} as const
export const BUILTIN_COMMANDS = Object.keys(BUILTIN_DESCRIPTIONS) as (keyof typeof BUILTIN_DESCRIPTIONS)[]
export type BuiltinCommand = (typeof BUILTIN_COMMANDS)[number]

export interface CommandItem { name: string; description: string; kind: 'builtin' | 'command' | 'skill' }

/** Everything the "/" autocomplete offers. Built-ins win over custom commands, commands over skills. */
export async function listCommands(
  workspaceRoot: string | undefined, // undefined = untrusted workspace: user dir only
  skills: { name: string; description: string }[] = []
): Promise<CommandItem[]> {
  const out = new Map<string, CommandItem>()
  const add = (i: CommandItem) => { if (!out.has(i.name)) out.set(i.name, i) }
  for (const n of BUILTIN_COMMANDS) add({ name: n, description: BUILTIN_DESCRIPTIONS[n], kind: 'builtin' })
  for (const dir of [...(workspaceRoot ? [join(workspaceRoot, '.claude', 'commands')] : []), join(os.homedir(), '.claude', 'commands')]) {
    const files = await fs.readdir(dir).catch(() => [] as string[])
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      const raw = await fs.readFile(join(dir, f), 'utf-8').catch(() => null)
      if (raw === null) continue
      const name = f.slice(0, -3)
      add({ name, description: parseFrontmatter(raw).meta.description || `Custom command: ${name}`, kind: 'command' })
    }
  }
  for (const s of skills) add({ name: s.name, description: s.description.slice(0, 160), kind: 'skill' })
  return [...out.values()]
}

export function parseSlash(input: string): { name: string; args: string } | null {
  const m = /^\s*\/([\w.-]+)(?:\s+([\s\S]*))?$/.exec(input)
  return m ? { name: m[1], args: (m[2] ?? '').trim() } : null
}

export const isBuiltin = (name: string): name is BuiltinCommand => (BUILTIN_COMMANDS as readonly string[]).includes(name)

/** Returns the expanded prompt for a custom command, or null when none matches. Workspace beats user dir. */
export async function expandCustomCommand(name: string, args: string, workspaceRoot: string | undefined): Promise<string | null> {
  for (const dir of [...(workspaceRoot ? [join(workspaceRoot, '.claude', 'commands')] : []), join(os.homedir(), '.claude', 'commands')]) {
    // name is restricted to [\w.-] by parseSlash, but ".." alone would still escape: reject it
    if (name.includes('..')) return null
    const raw = await fs.readFile(join(dir, `${name}.md`), 'utf-8').catch(() => null)
    if (raw === null) continue
    const { body } = parseFrontmatter(raw)
    return body.includes('$ARGUMENTS') ? body.split('$ARGUMENTS').join(args) : args ? `${body.trimEnd()}\n\n${args}` : body
  }
  return null
}

// USD per million tokens. Approximate list prices; update when pricing changes.
const PRICE: { match: RegExp; in: number; out: number }[] = [
  { match: /opus/i, in: 15, out: 75 },
  { match: /sonnet/i, in: 3, out: 15 },
  { match: /haiku/i, in: 1, out: 5 }
]

export interface UsageTotals { input: number; output: number; cacheRead: number; cacheWrite: number }

export function estimateCost(model: string, u: UsageTotals): number | null {
  const p = PRICE.find((x) => x.match.test(model))
  if (!p) return null
  // cache reads bill at 10% of input, cache writes at 125%
  return (u.input * p.in + u.cacheRead * p.in * 0.1 + u.cacheWrite * p.in * 1.25 + u.output * p.out) / 1_000_000
}
