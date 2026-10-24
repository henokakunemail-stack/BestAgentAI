// SKILL.md loader. Same format in Claude (~/.claude/skills), Codex (~/.codex/skills[/.system]),
// Antigravity (~/.gemini/config/skills, ~/.gemini/antigravity/builtin/skills): frontmatter name + description.
// Progressive disclosure: only name+description go in the system prompt; body loads via the Skill tool or an explicit /name.
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'

export interface SkillItem {
  name: string
  description: string
  trigger: string
  content: string
}

export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  let lastKey = ''
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) {
      lastKey = kv[1]
      meta[lastKey] = kv[2].replace(/^["']|["']$/g, '').trim()
      continue
    }
    // Block list under an empty key ("tools:\n  - Read") folds into "Read, Grep". Other indented
    // lines (nested metadata maps) are skipped, so `metadata:` stays ''.
    const item = /^\s+-\s+(.+)$/.exec(line)
    if (item && lastKey) {
      const v = item[1].replace(/^["']|["']$/g, '').trim()
      meta[lastKey] = meta[lastKey] ? `${meta[lastKey]}, ${v}` : v
    }
  }
  return { meta, body: raw.slice(m[0].length) }
}

/** "Read, Grep" / "[Read, Grep]" -> ['Read','Grep']. */
export function parseList(value: string | undefined): string[] {
  if (!value) return []
  return value.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '').trim()).filter(Boolean)
}

export class SkillsLoader {
  private dirs(workspaceRoot?: string): string[] {
    const h = os.homedir()
    return [
      ...(workspaceRoot ? [join(workspaceRoot, '.claude', 'skills'), join(workspaceRoot, '.ai-desktop', 'skills')] : []),
      join(h, '.claude', 'skills'),
      join(h, '.codex', 'skills'),
      join(h, '.codex', 'skills', '.system'),
      join(h, '.gemini', 'config', 'skills'),
      join(h, '.gemini', 'antigravity', 'builtin', 'skills')
    ]
  }

  /** First directory wins on name clash (workspace overrides user overrides builtin). */
  async loadAllSkills(workspaceRoot?: string): Promise<SkillItem[]> {
    const seen = new Map<string, SkillItem>()
    for (const dir of this.dirs(workspaceRoot)) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const raw = await fs.readFile(join(dir, entry.name, 'SKILL.md'), 'utf-8').catch(() => null)
        if (raw === null) continue
        const { meta, body } = parseFrontmatter(raw)
        const name = meta.name || entry.name
        if (seen.has(name)) continue
        seen.set(name, { name, description: meta.description || `Skill: ${name}`, trigger: `/${name}`, content: body })
      }
    }
    return [...seen.values()]
  }

  /** System-prompt block listing skills (descriptions only). */
  async catalogBlock(workspaceRoot?: string): Promise<string> {
    const skills = await this.loadAllSkills(workspaceRoot)
    if (!skills.length) return ''
    const lines = skills.map((s) => `- ${s.name}: ${s.description.slice(0, 300)}`)
    return `\n\n[Available skills] Call builtin__skill with a skill name when its description matches the task.\n${lines.join('\n')}`
  }

  async getSkill(name: string, workspaceRoot?: string): Promise<SkillItem | undefined> {
    return (await this.loadAllSkills(workspaceRoot)).find((s) => s.name === name)
  }

  /** Explicit invocation only: prompt starts with "/skill-name". No substring guessing. */
  async matchSkillPrompt(prompt: string, workspaceRoot?: string): Promise<string | null> {
    const m = /^\s*\/([\w.-]+)/.exec(prompt)
    if (!m) return null
    return (await this.getSkill(m[1], workspaceRoot))?.content ?? null
  }
}

export const skillsLoader = new SkillsLoader()
