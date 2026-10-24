// Pure permission policy (no electron/fs imports, so scripts/selfcheck.mts can test it).
// Modes follow Claude Code; "always allow this prefix" follows Codex execpolicy.
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypass' | 'dontAsk'
export interface Rules { allow: string[]; deny: string[] } // match: tool name or "tool:firstWord"
export type Decision = 'allow' | 'deny' | 'ask'

const READ_ONLY = /(^|_)(read|list|get|search|find|grep|glob|stat|view|inspect|status|query|fetch|open|analyze)/i
export const EDIT = /(write|edit|patch|create|mkdir|move|rename|update)/i
export const DANGER = /(delete|remove|exec|bash|shell|command|terminal|kill|drop)/i
// Built-in state tools with no filesystem/shell effect; prompting for them is noise.
const BOOKKEEPING = /^(update_plan|remember|update_goal|skill|bash_output|request_user_input|spawn_agent)$/ // bash_output: reading a job that bash/bash_kill already had to be approved for; request_user_input: asking is not acting

export const isReadOnly = (tool: string): boolean => READ_ONLY.test(tool) && !EDIT.test(tool) && !DANGER.test(tool)
/** Tools that must not run in parallel with others (shared by the runner's batching). */
export const isWriteLike = (tool: string): boolean => EDIT.test(tool) || DANGER.test(tool)

/**
 * Splits a shell command line into its simple commands on && || ; | & and newlines (quote aware).
 * null = cannot be judged safely (substitution, grouping, file redirect, unbalanced quote): the caller must ask.
 */
export function splitCommand(cmd: string): string[] | null {
  const segs: string[] = []
  let cur = ''
  let quote: '' | "'" | '"' = ''
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    const two = cmd.slice(i, i + 2)
    if (quote === "'") {
      if (c === "'") quote = ''
      cur += c
      continue
    }
    if (c === '`' || two === '$(' || two === '${') return null // substitution runs hidden commands, quoted or not
    if (quote === '"') {
      if (c === '"') quote = ''
      cur += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
      continue
    }
    if (two === '<(' || two === '>(' || c === '(' || c === ')' || c === '{' || c === '}') return null
    if (c === '>') {
      // Harmless stream plumbing only: 2>&1, >&2, >/dev/null, >nul. Any other redirect writes a file.
      const m = /^>{1,2}\s*(&\d|\/dev\/null\b|nul\b)/i.exec(cmd.slice(i))
      if (!m) return null
      cur += m[0]
      i += m[0].length - 1
      continue
    }
    if (c === '&' || c === '|' || c === ';' || c === '\n') {
      // "2>&1" was consumed above; a lone & is a separator
      if (cur.trim()) segs.push(cur.trim())
      cur = ''
      if ((c === '&' || c === '|') && cmd[i + 1] === c) i++
      continue
    }
    cur += c
  }
  if (quote) return null
  if (cur.trim()) segs.push(cur.trim())
  return segs
}

/**
 * Rule keys of one call: "tool:program" per simple command of args.command, else [tool].
 * [] = no key can describe the call (unparsable, empty, or a VAR=x prefix that changes behaviour): never covered by an allow rule.
 */
export function ruleKeys(tool: string, args: any): string[] {
  if (typeof args?.command !== 'string') return [tool]
  const segs = splitCommand(args.command)
  if (!segs?.length) return []
  const keys: string[] = []
  for (const s of segs) {
    const first = s.split(/\s+/)[0]
    if (/^[A-Za-z_]\w*=/.test(first)) return []
    keys.push(tool + ':' + first)
  }
  return [...new Set(keys)]
}

export const ruleKey = (tool: string, args: any): string => ruleKeys(tool, args)[0] ?? tool

/**
 * key(s): every rule key of the call (see ruleKeys). deny: any key matches. allow rule: all keys match.
 * qualified: namespaced tool name (mcp__server__tool) when different from tool; rules for it match as well.
 */
export function decide(mode: PermissionMode, tool: string, key: string | string[], rules: Rules, qualified = tool): Decision {
  const keys = Array.isArray(key) ? key : [key]
  if (rules.deny.some((d) => keys.includes(d) || tool === d || qualified === d)) return 'deny'
  // Every plan needs its own approval: never covered by allow rules, and only valid in plan mode.
  if (tool === 'exit_plan_mode') return mode === 'plan' ? 'ask' : 'deny'
  if (mode === 'plan' && !isReadOnly(tool) && !BOOKKEEPING.test(tool)) return 'deny'
  if (mode === 'bypass' || BOOKKEEPING.test(tool)) return 'allow'
  const ruled = (keys.length > 0 && keys.every((k) => rules.allow.includes(k))) || rules.allow.includes(tool) || rules.allow.includes(qualified)
  if (ruled || isReadOnly(tool)) return 'allow'
  if (mode === 'acceptEdits' && EDIT.test(tool) && !DANGER.test(tool)) return 'allow'
  return mode === 'dontAsk' ? 'deny' : 'ask' // dontAsk: anything not already allowed is refused, never prompted
}
