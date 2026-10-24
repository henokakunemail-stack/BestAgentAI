// Typed subagents: <workspace>/.claude/agents/*.md, <workspace>/.ai-desktop/agents/*.md, ~/.claude/agents/*.md.
// Same format as Claude Code: frontmatter name, description, tools (comma list), model; body = the agent's system prompt.
// Workspace beats user dir; first match wins.
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { parseFrontmatter, parseList } from './skillsLoader'

export interface AgentDef {
  name: string
  description: string
  /** App tool names (e.g. builtin__read_file). undefined = inherit every tool the parent has. */
  tools?: string[]
  model?: string
  prompt: string
}

// Claude Code tool name -> this app's builtin tool.
const TOOL_MAP: Record<string, string> = {
  Read: 'read_file', Write: 'write_file', Edit: 'edit_file', MultiEdit: 'edit_file', NotebookEdit: 'edit_file',
  Glob: 'glob', Grep: 'grep', Bash: 'bash', WebFetch: 'web_fetch', Skill: 'skill',
  TodoWrite: 'update_plan', Task: 'spawn_agent', ExitPlanMode: 'exit_plan_mode'
}

/** Maps a Claude Code tool name to the namespaced tool name used here. Unknown names pass through (MCP tools). */
export function mapToolName(n: string): string {
  const mapped = TOOL_MAP[n]
  if (mapped) return `builtin__${mapped}`
  const mcp = /^mcp__(.+?)__(.+)$/.exec(n) // Claude Code: mcp__server__tool, here: server__tool
  return mcp ? `${mcp[1]}__${mcp[2]}` : n
}

export function mapTools(list: string[]): string[] {
  const out = new Set(list.map(mapToolName))
  for (const n of ['builtin__exit_plan_mode', 'exit_plan_mode']) out.delete(n) // a subagent must never be able to leave plan mode
  return [...out]
}

export async function loadAgents(workspaceRoot?: string): Promise<AgentDef[]> {
  const h = os.homedir()
  const dirs = [
    ...(workspaceRoot ? [join(workspaceRoot, '.claude', 'agents'), join(workspaceRoot, '.ai-desktop', 'agents')] : []),
    join(h, '.claude', 'agents')
  ]
  const seen = new Map<string, AgentDef>()
  for (const dir of dirs) {
    const files = await fs.readdir(dir).catch(() => [] as string[])
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      const raw = await fs.readFile(join(dir, f), 'utf-8').catch(() => null)
      if (raw === null) continue
      const { meta, body } = parseFrontmatter(raw)
      const name = meta.name || f.slice(0, -3)
      if (seen.has(name)) continue
      const tools = parseList(meta.tools)
      seen.set(name, {
        name,
        description: meta.description || `Agent: ${name}`,
        tools: tools.length ? mapTools(tools) : undefined,
        model: meta.model && meta.model !== 'inherit' ? meta.model : undefined,
        prompt: body.trim()
      })
    }
  }
  return [...seen.values()]
}

/** Text appended to the spawn_agent description / parent system prompt. */
export function agentCatalog(agents: AgentDef[]): string {
  if (!agents.length) return ''
  return `Available agent_type values:\n${agents.map((a) => `- ${a.name}: ${a.description.slice(0, 200)}`).join('\n')}`
}

const MODEL_ALIASES: Record<string, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' }
/** Claude Code agent files use short aliases (model: sonnet); API calls need full ids. */
export const resolveModelAlias = (m: string): string => MODEL_ALIASES[m.toLowerCase()] ?? m
