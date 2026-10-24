// Claude Code / Antigravity style hooks. Config: <userData>/data/hooks.json
// { "<HookEvent>": [{ "matcher": "regex", "command": "...", "timeoutMs": 30000 }] }
// matcher is tested against the tool name for tool events, and against `source` (SessionStart),
// `agent_type` (SubagentStart/Stop), `trigger` (PreCompact/PostCompact) or `reason` (SessionEnd) for the others. Empty or "*" matches all.
// Payload: PreToolUse/PostToolUse get tool_input (+ tool_response); UserPromptSubmit gets prompt.
// PermissionRequest (tool name matcher) fires before the user is asked: permissionDecision allow/deny answers for them, exit 2 denies.
// PermissionDenied (tool name), Notification {message} (run waits on the user) and StopFailure {error} (run died) are informational.
// Hook gets JSON on stdin (hook_event_name, session_id, cwd, then the payload). Exit 0 = pass (stdout JSON may
// carry additionalContext / permissionDecision), exit 2 = block, stderr goes to the model. Other exit codes: ignored.
import { spawn, execFile } from 'node:child_process'

// Subset of the 32 events found in Claude desktop's bundle (see docs/re-notes/claude-desktop.md).
export const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit',
  'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact',
  'SessionEnd', 'PermissionRequest', 'PermissionDenied', 'Notification', 'StopFailure'
] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]
export interface HookDef { matcher?: string; command: string; timeoutMs?: number }
export type HookConfig = Partial<Record<HookEvent, HookDef[]>>
export interface HookResult { blocked: boolean; reason?: string; additionalContext?: string; permissionDecision?: 'allow' | 'deny' | 'ask' }
export interface HookCtx { sessionId?: string; cwd?: string; /** aborting kills the running hook process tree and skips the remaining hooks */ signal?: AbortSignal }

/** What the matcher is tested against for this event. */
function matchTarget(event: HookEvent, toolName: string, payload: any): string {
  if (event === 'SessionStart') return String(payload?.source ?? '')
  if (event === 'SessionEnd') return String(payload?.reason ?? '')
  if (event === 'SubagentStart' || event === 'SubagentStop') return String(payload?.agent_type ?? '')
  if (event === 'PreCompact' || event === 'PostCompact') return String(payload?.trigger ?? '')
  return toolName
}

/** Returns an error string when the config shape or a regex is invalid, else null. */
export function validateHookConfig(cfg: unknown): string | null {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'hooks config must be an object'
  for (const [event, defs] of Object.entries(cfg)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) return `unknown hook event: ${event}`
    if (!Array.isArray(defs)) return `${event} must be an array`
    for (const d of defs as any[]) {
      if (!d || typeof d.command !== 'string' || !d.command.trim()) return `${event}: command is required`
      if (d.timeoutMs !== undefined && !(Number.isFinite(d.timeoutMs) && d.timeoutMs > 0)) return `${event}: timeoutMs must be a positive number`
      if (d.matcher) {
        try { new RegExp(d.matcher) } catch { return `${event}: invalid matcher regex "${d.matcher}"` }
      }
    }
  }
  return null
}

export async function runHooksWithConfig(
  cfg: HookConfig,
  event: HookEvent,
  toolName: string,
  payload: unknown,
  ctx: HookCtx = {}
): Promise<HookResult> {
  const target = matchTarget(event, toolName, payload)
  const defs = (cfg[event] || []).filter((h) => {
    if (!h.matcher || h.matcher === '*') return true
    try { return new RegExp(h.matcher).test(target) } catch { return false }
  })
  const result: HookResult = { blocked: false }
  // Envelope last-wins would let a payload key overwrite hook_event_name; put the fixed fields after the payload.
  const stdin = JSON.stringify({
    ...(payload as object),
    hook_event_name: event,
    tool_name: toolName,
    session_id: ctx.sessionId,
    cwd: ctx.cwd
  })
  for (const def of defs) {
    if (ctx.signal?.aborted) break
    const r = await runOne(def, stdin, ctx.cwd, ctx.signal)
    if (r.code === 2) return { blocked: true, reason: r.stderr.trim() || 'blocked by hook' }
    if (r.code === 0 && r.stdout.trim().startsWith('{')) {
      try {
        const j = JSON.parse(r.stdout)
        const o = j.hookSpecificOutput || {}
        if (o.additionalContext) result.additionalContext = (result.additionalContext || '') + o.additionalContext
        if (o.permissionDecision) result.permissionDecision = o.permissionDecision
        if (o.permissionDecision === 'deny') return { blocked: true, reason: o.permissionDecisionReason || 'denied by hook' }
      } catch { /* malformed JSON: ignore, like Claude Code */ }
    }
  }
  return result
}

export async function runHooks(event: HookEvent, toolName: string, payload: unknown, ctx: HookCtx = {}): Promise<HookResult> {
  // Lazy import keeps this module free of the electron dependency in db.ts (selfcheck runs it under plain Node).
  const { readJson } = await import('../storage/db')
  return runHooksWithConfig(await readJson<HookConfig>('hooks.json', {}), event, toolName, payload, ctx)
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
  else try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
}

const MAX_HOOK_OUTPUT = 1_000_000 // chars kept per stream; a chatty hook must not grow memory without bound

function runOne(def: HookDef, stdin: string, cwd?: string, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(def.command, { shell: true, windowsHide: true, cwd })
    let stdout = '', stderr = ''
    // On Windows p.kill() only ends cmd.exe and leaves the real command running; kill the whole tree.
    const kill = () => killTree(p.pid)
    const t = setTimeout(kill, def.timeoutMs ?? 30000)
    signal?.addEventListener('abort', kill, { once: true })
    const done = (code: number) => { clearTimeout(t); signal?.removeEventListener('abort', kill); resolve({ code, stdout, stderr }) }
    p.stdout.on('data', (d) => { if (stdout.length < MAX_HOOK_OUTPUT) stdout += d })
    p.stderr.on('data', (d) => { if (stderr.length < MAX_HOOK_OUTPUT) stderr += d })
    p.on('error', () => done(1))
    p.on('close', (code) => done(code ?? 1))
    if (signal?.aborted) kill()
    p.stdin.on('error', () => {})
    p.stdin.end(stdin)
  })
}
