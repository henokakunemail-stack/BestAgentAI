// One gate per agent run: mode and abort signal belong to that run, so a subagent can never flip the
// parent's mode and aborting one session never denies another session's prompts.
// Pending prompts live in a shared registry keyed by callId (Anthropic tool_use ids are globally unique),
// because the renderer answers with only { callId, approved, always }.
import { readJson, updateJson } from '../storage/db'
import { decide, ruleKeys, isReadOnly, type PermissionMode, type Rules } from './permissionPolicy'

export type { PermissionMode }
type Answer = 'allow' | 'deny' | 'always'

const RULES_FILE = 'permissions.json'
const pending = new Map<string, (a: Answer) => void>()
// request_user_input prompts: answered with free text, or null when the run is aborted
const pendingInput = new Map<string, (a: string | null) => void>()

/** Asks the user a question and waits. Resolves null on abort. Registered synchronously so an abort cannot miss it. */
export function askUserInput(callId: string, signal: AbortSignal | undefined, emit: (e: any) => void, question: string, options?: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (a: string | null) => {
      signal?.removeEventListener('abort', onAbort)
      pendingInput.delete(callId)
      resolve(a)
    }
    const onAbort = () => done(null)
    if (signal?.aborted) return done(null)
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingInput.set(callId, done)
    emit({ type: 'user_input_request', callId, question, options })
  })
}

export class PermissionGate {
  mode: PermissionMode
  private signal?: AbortSignal

  constructor(opts: { mode: PermissionMode; signal?: AbortSignal }) {
    this.mode = opts.mode
    this.signal = opts.signal
  }

  /** IPC entry point (TOOL_CONFIRM_DECISION). */
  static resolveDecision(callId: string, approved: boolean, always = false): void {
    const resolve = pending.get(callId)
    if (!resolve) return
    pending.delete(callId)
    resolve(!approved ? 'deny' : always ? 'always' : 'allow')
  }

  /** IPC entry point (USER_INPUT_ANSWER). */
  static resolveInput(callId: string, answer: string): void {
    pendingInput.get(callId)?.(answer)
  }

  isReadOnly = isReadOnly

  private ask(callId: string, toolName: string, args: any, emit: (e: any) => void, canAlways: boolean): Promise<Answer> {
    // Registered synchronously, before any other await, so an abort can never miss it.
    return new Promise<Answer>((resolve) => {
      const done = (a: Answer) => {
        this.signal?.removeEventListener('abort', onAbort)
        pending.delete(callId)
        resolve(a)
      }
      const onAbort = () => done('deny')
      if (this.signal?.aborted) return done('deny')
      this.signal?.addEventListener('abort', onAbort, { once: true })
      pending.set(callId, done)
      emit({ type: 'tool_permission_request', callId, toolName, args, canAlways })
    })
  }

  /** `beforeAsk` runs only when the user would be prompted; it may answer for them (PermissionRequest hook). */
  async checkPermission(callId: string, toolName: string, args: any, emit: (e: any) => void, beforeAsk?: () => Promise<boolean | undefined>, ruleTool = toolName): Promise<boolean> {
    if (this.signal?.aborted) return false
    // ruleTool: what rules are written against (builtin: plain name, MCP: server-qualified name so two servers never share a rule)
    const keys = ruleKeys(ruleTool, args)
    const rules = await readJson<Rules>(RULES_FILE, { allow: [], deny: [] })
    const d = decide(this.mode, toolName, keys, rules, ruleTool)
    if (d !== 'ask') return d === 'allow'
    const auto = await beforeAsk?.()
    if (auto !== undefined) return auto

    // "Always" only for a single simple command: a chain or $() would mint a rule broader than what the user read.
    const canAlways = keys.length === 1 && toolName !== 'exit_plan_mode'
    const answer = await this.ask(callId, toolName, args, emit, canAlways)
    if (answer === 'always' && canAlways) {
      // Locked read-modify-write: another prompt may be saving rules at the same time.
      await updateJson<Rules>(RULES_FILE, { allow: [], deny: [] }, (fresh) => {
        if (!fresh.allow.includes(keys[0])) fresh.allow.push(keys[0])
        return fresh
      })
    }
    return answer !== 'deny'
  }
}
