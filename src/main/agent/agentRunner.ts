import Anthropic from '@anthropic-ai/sdk'
import { mcpManager } from '../mcp/mcpClientManager'
import { PermissionGate, askUserInput, type PermissionMode } from '../mcp/permissionGate'
import { convertMcpToAnthropicTool, parseToolName } from './toolConverter'
import { sanitizeTerminalOutput } from './rtkProxy'
import { skillsLoader } from './skillsLoader'
import { textOf } from './attachments'
import { parseExecutionError, buildSelfHealingPrompt } from './selfHealer'
import { getSettings, saveSettings } from '../storage/settingsStore'
import { compact, currentTokens, shouldCompact, capToolResult, capTurnResults, pruneOldToolResults, withCacheBreakpoint, closeDanglingToolUse } from './compactor'
import { limitsFor, initialMaxTokens, billableTokens } from './modelLimits'
import { runHooks } from './hooks'
import { loadProjectDocs } from './projectDocs'
import { isWorkspaceTrusted } from './trust'
import { snapshot, writeTargets } from './checkpoints'
import { killOwner } from './bgJobs'
import { extractMemories, memoryPromptBlock } from './memoryExtractor'
import { clientConfig, makeAnthropic } from './clientFactory'
import { classifyError, retryDelayMs, stopAction, MAX_RETRIES } from './retryPolicy'
import { BUILTIN_SERVER, BUILTIN_TOOLS, buildSpawnTool, EXIT_PLAN_TOOL, runBuiltin, isWriteTool } from './builtinTools'
import { loadAgents, agentCatalog, resolveModelAlias, type AgentDef } from './agentsLoader'
import { randomUUID } from 'node:crypto'
import { WorktreeManager } from './worktreeManager'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_DEPTH = 1
const MAX_SUBAGENTS_PER_RUN = 5
const MAX_CONTINUATIONS = 3 // consecutive max_tokens continuations
const MAX_TRUNCATIONS = 2 // consecutive truncated tool calls

interface RunOpts {
  goalId?: string
  onUsage?: (tokens: number) => void
  onUsageDetail?: (u: { input: number; output: number; cacheRead: number; cacheWrite: number }) => void
  workspaceRoot?: string
  depth?: number
  /** subagent: skip memory extraction and final 'done' event */
  quiet?: boolean
  /** subagent: mode inherited from the parent run (never re-read from settings, so a child cannot widen it) */
  permissionMode?: PermissionMode
  /** subagent: namespaced tool names it may use. undefined = all. Enforced again at execution time. */
  allowedTools?: string[]
  /** subagent: replaces the generic role line of the system prompt */
  agentPrompt?: string
  agentType?: string
  model?: string
  /** extra system text, e.g. SessionStart hook output */
  extraSystem?: string
  /** parent signal: aborting it aborts this run */
  parentSignal?: AbortSignal
  /** tags forwarded events so the UI can nest subagent cards under the spawn_agent card */
  parentCallId?: string
  /** subagent: workspace trust decided by the parent run */
  trusted?: boolean
  /** file checkpoints: files are snapshotted under (dir, session, turn) before a write tool runs */
  checkpoint?: { dir: string; turn: number }
}

/** Everything one run needs; passed to executeOne/spawnSubagent instead of reading shared state. */
interface RunCtx {
  /** this run's own signal; children chain off it */
  parentSignalFor: AbortSignal
  sessionId: string
  runId: string
  workspaceRoot: string
  depth: number
  spawned: { count: number }
  opts: RunOpts
  gate: PermissionGate
  agents: AgentDef[]
  trusted: boolean
}

/** Sleep that ends early (without throwing) when the signal aborts. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })

export class AgentRunner {
  private controllers = new Map<string, AbortController>()

  /** Manual /compact. Returns the original array when there is nothing to fold. */
  async compactNow(messages: Anthropic.MessageParam[], instructions = ''): Promise<Anthropic.MessageParam[]> {
    const settings = await getSettings()
    const cfg = clientConfig(settings)
    if ('error' in cfg) throw new Error(cfg.error)
    await runHooks('PreCompact', '', { trigger: 'manual', messages: messages.length })
    const out = await compact(makeAnthropic(cfg), settings.model || 'claude-opus-5-5', messages, instructions)
    if (out !== messages) await runHooks('PostCompact', '', { trigger: 'manual', messages: out.length })
    return out
  }

  /** App is closing: stop every run (and subagent) so none outlives its window. */
  abortAll(): void {
    for (const c of this.controllers.values()) c.abort()
  }

  abort(sessionId: string): void {
    // Each run's gate listens to its own signal, so pending prompts of this session are denied
    // and other sessions are untouched. Subagent signals chain off the parent signal as well.
    for (const [key, c] of this.controllers) if (key === sessionId || key.startsWith(`${sessionId}:sub:`)) c.abort()
  }

  /**
   * One streamed model call with retry (retryPolicy.classifyError): rate limits, 5xx, network errors and idle streams.
   * Before each retry onRetry fires so the caller can discard the partial text already streamed to the UI.
   */
  private async streamWithRetry(
    anthropic: Anthropic,
    params: Anthropic.MessageStreamParams,
    onEvent: (e: Anthropic.MessageStreamEvent) => void,
    signal: AbortSignal,
    onRetry: (info: { attempt: number; delayMs: number; reason: string }) => void
  ): Promise<Anthropic.Message> {
    const idleMs = Number(process.env.AI_STREAM_IDLE_MS) || 90_000
    for (let attempt = 0; ; attempt++) {
      const stream = anthropic.messages.stream(params, { signal })
      let idle: NodeJS.Timeout | undefined
      let idled = false
      const arm = () => {
        clearTimeout(idle)
        idle = setTimeout(() => {
          idled = true
          stream.abort()
        }, idleMs)
      }
      try {
        stream.on('streamEvent', (e) => {
          arm()
          onEvent(e)
        })
        arm()
        return await stream.finalMessage()
      } catch (raw: any) {
        const err = idled && !signal.aborted ? Object.assign(new Error('stream idle timeout'), { name: 'StreamIdleError' }) : raw
        if (signal.aborted || classifyError(err) !== 'retry' || attempt >= MAX_RETRIES - 1) throw err
        const delayMs = retryDelayMs(attempt, err)
        onRetry({ attempt: attempt + 1, delayMs, reason: String(err?.message ?? err).slice(0, 200) })
        await sleep(delayMs, signal)
      } finally {
        clearTimeout(idle)
      }
    }
  }

  async run(
    messages: Anthropic.MessageParam[],
    emitEvent: (event: any) => void,
    sessionId = 'default',
    opts: RunOpts = {}
  ): Promise<Anthropic.MessageParam[]> {
    // Controller first: a Stop click while settings, trust, hooks or the prompt are still loading must find it.
    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    const signal = controller.signal
    // Subagent: aborting the parent run aborts this one too.
    const onParentAbort = () => controller.abort()
    if (opts.parentSignal?.aborted) controller.abort()
    else opts.parentSignal?.addEventListener('abort', onParentAbort, { once: true })
    const checkAbort = () => {
      if (signal.aborted) throw new Error('Aborted')
    }

    const runId = randomUUID()
    const depth = opts.depth ?? 0
    let history = [...messages]
    // Last API-reported context size and the history length it described (see compactor.currentTokens).
    let known = { tokens: 0, len: 0 }
    let systemPrompt = ''
    let failCtx: { sessionId: string; cwd?: string } = { sessionId: sessionId.split(':sub:')[0] } // for StopFailure when the throw happens before settings load

    try {
      // Everything below is inside the try: any throw (settings, skills, hooks, project docs) must still release the controller.
      const settings = await getSettings()
      checkAbort()
      const cfg = clientConfig(settings)
      if ('error' in cfg) {
        emitEvent({ type: 'error', error: cfg.error })
        emitEvent({ type: 'done' })
        return messages
      }
      const workspaceRoot = opts.workspaceRoot ?? settings.workspaceRoot
      // Own gate per run: mode and abort belong to this run only. A subagent inherits its parent's mode.
      const gate = new PermissionGate({ mode: opts.permissionMode ?? settings.permissionMode, signal })
      // Untrusted workspace: its CLAUDE.md, agents, skills and commands are not loaded. Children inherit the parent's answer (a worktree path is not in the list).
      const trusted = opts.trusted ?? (await isWorkspaceTrusted(workspaceRoot).catch(() => false))
      checkAbort()
      const agents = depth === 0 && trusted ? await loadAgents(workspaceRoot).catch(() => [] as AgentDef[]) : []
      checkAbort()
      const ctx: RunCtx = { parentSignalFor: signal, sessionId, runId, workspaceRoot, depth, spawned: { count: 0 }, opts, gate, agents, trusted }
      const anthropic = makeAnthropic(cfg)
      const model = opts.model || settings.model || 'claude-opus-5-5'
      const hookCtx = { sessionId: sessionId.split(':sub:')[0], cwd: workspaceRoot, signal }
      failCtx = { sessionId: hookCtx.sessionId, cwd: workspaceRoot }

      const prep = await this.buildSystemPrompt(history, ctx, hookCtx)
      checkAbort()
      if (prep.blockedReason) {
        emitEvent({ type: 'error', error: `Prompt blocked by hook: ${prep.blockedReason}` })
        emitEvent({ type: 'done' })
        return history
      }
      systemPrompt = prep.text

      let ended = false // still false after the loop = maxTurns ran out (or abort)
      let continuations = 0
      let truncations = 0
      const limits = limitsFor(model, settings.contextWindow)
      let maxTokens = initialMaxTokens(limits.maxOutput)
      let overflowFixed = false // one reactive prune+compact per failing turn
      /** Fold the history: elide old tool output first, then summarise. Returns false when nothing changed. */
      const shrink = async (trigger: string, keepRecent: number): Promise<boolean> => {
        let changed = false
        const pruned = pruneOldToolResults(history, keepRecent)
        if (pruned.some((m, i) => m !== history[i])) {
          history = pruned
          changed = true
        }
        if (trigger === 'overflow' || shouldCompact(currentTokens(history, changed ? { tokens: 0, len: 0 } : known), limits.contextWindow)) {
          await runHooks('PreCompact', '', { trigger, messages: history.length }, hookCtx)
          const before = history.length
          try {
            history = await compact(anthropic, model, history, '', signal)
          } catch (e: any) {
            if (signal.aborted) throw e
            emitEvent({ type: 'text', delta: `\n_[compaction failed: ${String(e?.message ?? e).slice(0, 160)}]_\n` })
          }
          if (history.length !== before) {
            changed = true
            emitEvent({ type: 'text', delta: '\n_[context compacted]_\n' })
            await runHooks('PostCompact', '', { trigger, messages: history.length }, hookCtx)
          }
        }
        if (changed) known = { tokens: 0, len: 0 } // old usage no longer describes this history
        return changed
      }
      for (let turn = 0; turn < settings.maxTurns; turn++) {
        if (signal.aborted) break

        const tokensNow = currentTokens(history, known)
        if (tokensNow >= limits.contextWindow * 0.6) await shrink('auto', 6)

        // Re-evaluated each turn: exit_plan_mode approval flips the gate to acceptEdits mid-run.
        const planning = gate.mode === 'plan'
        // Stable order (builtins as declared, MCP by name): a reordered tool list would miss the prompt cache.
        const mcpTools = mcpManager.getAllTools().map(convertMcpToAnthropicTool).sort((a, b) => a.name.localeCompare(b.name))
        const offered: Anthropic.Tool[] = [...BUILTIN_TOOLS.filter((t) => depth === 0 || !t.name.endsWith('__request_user_input')),...(planning && depth === 0 ? [EXIT_PLAN_TOOL] : []), ...(depth < MAX_DEPTH ? [buildSpawnTool(agentCatalog(agents))] : []), ...mcpTools]
        // Typed subagent: only whitelisted tools are offered (and executeOne rejects anything else).
        const tools = opts.allowedTools ? offered.filter((t) => opts.allowedTools!.includes(t.name)) : offered

        // Chars this attempt already pushed to the UI; a retry tells the renderer to drop exactly that much.
        let sentText = 0
        let sentThinking = 0
        let finalMessage: Anthropic.Message
        try {
        finalMessage = await this.streamWithRetry(
          anthropic,
          {
            model,
            max_tokens: maxTokens,
            // ponytail: SDK 0.39 types only have enabled|disabled; 'adaptive' is accepted by the Claude 5 API, hence the cast below. Drop the cast when the SDK is upgraded.
            // ponytail: off through 9router (non-Claude models reject/ignore it). Upgrade path: per-model capability flag.
            thinking: settings.enableThinking && settings.provider !== '9router' ? { type: 'adaptive' } : undefined,
            // Prompt caching: breakpoints on the last system block and last tool cache the whole stable prefix.
            system: [
              {
                type: 'text',
                text: planning
                  ? `${systemPrompt}\nPLAN MODE: read-only. Explore with read_file/glob/grep, then call builtin__exit_plan_mode with your plan. Do not modify anything until the user approves.`
                  : systemPrompt,
                cache_control: { type: 'ephemeral' }
              }
            ],
            ...(tools.length ? { tools: tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t)) } : {}),
            messages: withCacheBreakpoint(history) // third breakpoint: the conversation so far is cached, only the new tail is billed in full
          } as unknown as Anthropic.MessageStreamParams,
          (event) => {
            if (event.type === 'content_block_delta') {
              if (event.delta.type === 'thinking_delta') {
                sentThinking += event.delta.thinking.length
                emitEvent({ type: 'thinking', delta: event.delta.thinking })
              } else if (event.delta.type === 'text_delta') {
                sentText += event.delta.text.length
                emitEvent({ type: 'text', delta: event.delta.text })
              }
            }
          },
          signal,
          (info) => {
            emitEvent({ type: 'stream_reset', dropText: sentText, dropThinking: sentThinking })
            sentText = sentThinking = 0
            emitEvent({ type: 'retrying', ...info })
          }
        )
        } catch (err: any) {
          // Context too long: fold the history once and redo this turn; a second overflow is a real error.
          if (!signal.aborted && classifyError(err) === 'overflow' && !overflowFixed) {
            overflowFixed = true
            emitEvent({ type: 'stream_reset', dropText: sentText, dropThinking: sentThinking })
            if (await shrink('overflow', 2)) {
              turn-- // redo this turn on the smaller history
              continue
            }
          }
          throw err
        }
        overflowFixed = false
        history.push({ role: 'assistant', content: finalMessage.content })
        const u = finalMessage.usage as Anthropic.Usage | undefined
        // input_tokens excludes cached prompt tokens; they still occupy the context window.
        const ctxTokens = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.output_tokens ?? 0)
        known = { tokens: ctxTokens, len: history.length }
        const usage = {
          input: u?.input_tokens ?? 0,
          output: u?.output_tokens ?? 0,
          cacheRead: u?.cache_read_input_tokens ?? 0,
          cacheWrite: u?.cache_creation_input_tokens ?? 0
        }
        opts.onUsage?.(billableTokens(usage))
        opts.onUsageDetail?.(usage)

        const toolUses = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        const action = stopAction(finalMessage.stop_reason, toolUses.length > 0)
        if (action !== 'continue') continuations = 0
        if (action !== 'truncated_tool') truncations = 0

        if (action === 'refusal') {
          emitEvent({ type: 'error', error: 'The model refused to respond to this request.' })
          ended = true
          break
        }
        if (action === 'resume') continue // pause_turn: send the assistant turn back as is and let the model go on
        if ((action === 'continue' || action === 'truncated_tool') && maxTokens < limits.maxOutput) maxTokens = limits.maxOutput // later turns may need the full ceiling
        if (action === 'continue') {
          // Output cut off by max_tokens: ask for the rest, a few times at most.
          if (++continuations > MAX_CONTINUATIONS) {
            emitEvent({ type: 'error', error: 'Output limit reached: the reply was cut off repeatedly.' })
            ended = true
            break
          }
          history.push({ role: 'user', content: 'Continue exactly where you stopped.' })
          continue
        }
        if (action === 'truncated_tool') {
          // A tool_use cut off mid-JSON must never run. Answer every call with an error so the history stays valid.
          const answer = (msg: string): Anthropic.MessageParam => ({ role: 'user', content: toolUses.map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: msg, is_error: true })) })
          if (++truncations > MAX_TRUNCATIONS) {
            history.push(answer('Output truncated.'))
            emitEvent({ type: 'error', error: 'Output limit reached while writing a tool call. Try a smaller step.' })
            ended = true
            break
          }
          history.push(answer('Your output hit the token limit and this tool call was cut off, so it was NOT run. Retry with smaller content (for large files write in several steps).'))
          continue
        }
        if (action === 'finish') {
          const stop = await runHooks('Stop', '', { messages: history.length }, hookCtx)
          if (stop.blocked) {
            // Stop hook can veto completion and feed the reason back (Claude Code /goal pattern)
            history.push({ role: 'user', content: `[Stop hook] ${stop.reason}` })
            continue
          }
          ended = true
          break
        }

        const blocks = finalMessage.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        const results = new Array<Anthropic.ToolResultBlockParam>(blocks.length)

        // Parallel batches: contiguous read-only calls run together, write calls run alone (order kept).
        const cap = Math.max(1, settings.maxToolConcurrency)
        let i = 0
        while (i < blocks.length) {
          const batch = [i]
          if (!isWriteTool(blocks[i].name, blocks[i].input)) {
            while (batch.length < cap && i + batch.length < blocks.length && !isWriteTool(blocks[i + batch.length].name, blocks[i + batch.length].input)) {
              batch.push(i + batch.length)
            }
          }
          // allSettled: one rejected call must not leave sibling tool_use blocks without a tool_result (API 400 next turn).
          const settled = await Promise.allSettled(batch.map((idx) => this.executeOne(blocks[idx], settings, emitEvent, signal, ctx)))
          settled.forEach((r, k) => {
            results[batch[k]] =
              r.status === 'fulfilled'
                ? r.value
                : { type: 'tool_result', tool_use_id: blocks[batch[k]].id, content: String(r.reason?.message ?? r.reason), is_error: true }
          })
          i += batch.length
        }

        history.push({ role: 'user', content: capTurnResults(results) })
      }
      if (!ended && !signal.aborted) emitEvent({ type: 'error', error: `Stopped after ${settings.maxTurns} turns (maxTurns). Send "continue" to resume.` })
      if (!opts.quiet) emitEvent({ type: 'done' })
      if (!opts.quiet && !signal.aborted && history.length >= 4) void extractMemories(anthropic, model, history).catch(() => {})
    } catch (err: any) {
      if (signal.aborted) emitEvent({ type: 'aborted' })
      else {
        emitEvent({ type: 'error', error: err.message })
        await runHooks('StopFailure', '', { error: String(err.message).slice(0, 500) }, failCtx).catch(() => {})
      }
      emitEvent({ type: 'done' })
    } finally {
      this.controllers.delete(sessionId)
      killOwner(runId) // background shell jobs never outlive their run
      opts.parentSignal?.removeEventListener('abort', onParentAbort)
      closeDanglingToolUse(history)
    }
    return history
  }

  /** System prompt + UserPromptSubmit hook for one run. Throws are caught by run()'s try. */
  private async buildSystemPrompt(
    history: Anthropic.MessageParam[],
    ctx: RunCtx,
    hookCtx: { sessionId: string; cwd: string }
  ): Promise<{ text: string; blockedReason?: string }> {
    const { depth, workspaceRoot, opts } = ctx
    let text =
      opts.agentPrompt ??
      `You are AI Desktop, a high-capability agent environment. Plan with update_plan for multi-step work, explore with builtin__read_file/glob/grep, edit files with builtin__edit_file or builtin__apply_patch, run commands with builtin__bash, verify changes (run tests/build) before claiming completion, and fix errors you see in tool output.`
    text += ` Workspace root: ${workspaceRoot}.`
    text += depth === 0 ? ' Use builtin__spawn_agent for independent sub-tasks that can run in parallel.' : ' You are a subagent: finish the task and reply with a concise final report.'
    text += await memoryPromptBlock().catch(() => '')
    const skillRoot = ctx.trusted ? workspaceRoot : undefined
    if (ctx.trusted) text += await loadProjectDocs(workspaceRoot).catch(() => '')
    else if (depth === 0) text += '\n\n[Workspace is not trusted: its CLAUDE.md/AGENTS.md, agents, skills and commands are not loaded. The user can trust it from the banner.]'
    text += await skillsLoader.catalogBlock(skillRoot).catch(() => '')
    if (opts.extraSystem) text += `\n\n${opts.extraSystem}`
    const lastUserMsg = history.filter((m) => m.role === 'user').pop()
    const lastText = lastUserMsg ? textOf(lastUserMsg.content) : ''
    if (lastText) {
      const skill = await skillsLoader.matchSkillPrompt(lastText, skillRoot)
      if (skill) text += `\n\n[Active Skill Instructions]\n${skill}`
      if (depth === 0) {
        const hook = await runHooks('UserPromptSubmit', '', { prompt: lastText }, hookCtx)
        if (hook.blocked) return { text, blockedReason: hook.reason }
        if (hook.additionalContext) text += `\n\n[UserPromptSubmit hook]\n${hook.additionalContext}`
      }
    }
    return { text }
  }

  private async spawnSubagent(
    args: Record<string, any>,
    ctx: RunCtx,
    emitEvent: (e: any) => void,
    parentCallId: string
  ): Promise<string> {
    if (ctx.depth >= MAX_DEPTH) throw new Error('Subagents cannot spawn subagents.')
    if (ctx.spawned.count >= MAX_SUBAGENTS_PER_RUN) throw new Error(`Subagent limit reached (${MAX_SUBAGENTS_PER_RUN} per run).`)
    let task = String(args.task ?? '').trim()
    if (!task) throw new Error('spawn_agent requires "task"')

    let agent: AgentDef | undefined
    if (args.agent_type) {
      agent = ctx.agents.find((a) => a.name === args.agent_type)
      if (!agent) throw new Error(`Unknown agent_type "${args.agent_type}". Available: ${ctx.agents.map((a) => a.name).join(', ') || '(none)'}`)
    }
    const agentType = agent?.name ?? 'general'
    const hookCtx = { sessionId: ctx.sessionId, cwd: ctx.workspaceRoot, signal: ctx.parentSignalFor }

    const start = await runHooks('SubagentStart', '', { agent_type: agentType, task, isolate: !!args.isolate }, hookCtx)
    if (start.blocked) throw new Error(`Subagent blocked by hook: ${start.reason}`)
    if (start.additionalContext) task += `\n\n[SubagentStart hook]\n${start.additionalContext}`
    const n = ++ctx.spawned.count

    let root = ctx.workspaceRoot
    let isolationNote = ''
    let wt: WorktreeManager | undefined, wtId = '', baseSha = ''
    if (args.isolate) {
      // Real isolation only: no empty-folder fallback. Removed afterwards only if the subagent changed nothing.
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ctx.workspaceRoot }).catch(() => {
        throw new Error('isolate=true requires a git repository at the workspace root.')
      })
      wtId = `sub-${Date.now()}-${n}`
      if (ctx.parentSignalFor.aborted) throw new Error('Aborted by user.')
      wt = new WorktreeManager(ctx.workspaceRoot)
      root = await wt.createWorktree(wtId)
      baseSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
    }

    // Forward tool cards and plan/permission events, but not text/done/error (would corrupt the parent stream).
    // Tagged so the UI can nest them under the spawn_agent card.
    const forward = (e: any) => {
      if (e.type !== 'text' && e.type !== 'thinking' && e.type !== 'done' && e.type !== 'error' && e.type !== 'stream_reset' && e.type !== 'retrying') emitEvent({ ...e, parentCallId, agentType })
    }
    const out = await this.run([{ role: 'user', content: task }], forward, `${ctx.sessionId}:sub:${n}`, {
      goalId: ctx.opts.goalId,
      onUsage: ctx.opts.onUsage,
      onUsageDetail: ctx.opts.onUsageDetail,
      workspaceRoot: root,
      depth: ctx.depth + 1,
      quiet: true,
      permissionMode: ctx.gate.mode, // inherited: a child never runs with a wider mode than its parent
      allowedTools: agent?.tools,
      agentPrompt: agent?.prompt || undefined,
      agentType,
      model: agent?.model ? resolveModelAlias(agent.model) : undefined,
      parentSignal: ctx.parentSignalFor,
      parentCallId,
      trusted: ctx.trusted,
      checkpoint: root === ctx.workspaceRoot ? ctx.opts.checkpoint : undefined // a worktree is disposable and has other paths
    })
    const last = out[out.length - 1]
    const report =
      typeof last?.content === 'string'
        ? last.content
        : (last?.content as any[] | undefined)?.map((b) => (b.type === 'text' ? b.text : '')).join('') ?? ''
    if (wt && !(await wt.removeIfUnchanged(wtId, baseSha))) {
      isolationNote = `\n\n[worktree kept at ${root}, branch agent/${wtId}; review/merge or remove it yourself]`
    }
    await runHooks('SubagentStop', '', { agent_type: agentType, task, report: report.slice(0, 2000) }, hookCtx)
    return (report.trim() || '(subagent produced no final text)') + isolationNote
  }

  private async executeOne(
    block: Anthropic.ToolUseBlock,
    settings: Awaited<ReturnType<typeof getSettings>>,
    emitEvent: (e: any) => void,
    signal: AbortSignal,
    ctx: RunCtx
  ): Promise<Anthropic.ToolResultBlockParam> {
    const fail = (msg: string): Anthropic.ToolResultBlockParam => {
      emitEvent({ type: 'tool_call_result', callId: block.id, isError: true, output: msg })
      return { type: 'tool_result', tool_use_id: block.id, content: msg, is_error: true }
    }

    emitEvent({ type: 'tool_call_start', callId: block.id, toolName: block.name, input: block.input })
    if (signal.aborted) return fail('Aborted by user.')

    const { serverName, originalName } = parseToolName(block.name)
    const args = (block.input ?? {}) as Record<string, any>
    const hookCtx = { sessionId: ctx.sessionId.split(':sub:')[0], cwd: ctx.workspaceRoot, signal }

    // The model may emit a tool name that was never offered. Enforce the whitelist and the plan-exit rule here too.
    if (ctx.opts.allowedTools && !ctx.opts.allowedTools.includes(block.name)) {
      return fail(`Tool ${block.name} is not available to this agent.`)
    }
    if (originalName === 'exit_plan_mode' && ctx.depth > 0) return fail('Subagents cannot exit plan mode.')
    if (originalName === 'request_user_input' && (ctx.depth > 0 || ctx.gate.mode === 'dontAsk')) {
      return fail(ctx.depth > 0 ? 'Subagents cannot ask the user questions. Finish with your best judgment and state the assumption in your report.' : 'dontAsk mode never prompts the user. Proceed with your best judgment.')
    }

    const pre = await runHooks('PreToolUse', block.name, { tool_input: args }, hookCtx)
    if (pre.blocked) return fail(`Blocked by hook: ${pre.reason}`)

    // A hook "allow" must not bypass plan mode's read-only guarantee or the plan approval itself.
    const hookMayAllow = pre.permissionDecision === 'allow' && ctx.gate.mode !== 'plan' && originalName !== 'exit_plan_mode'
    if (!hookMayAllow) {
      const ruleTool = serverName === BUILTIN_SERVER ? originalName : block.name // MCP rules are server-qualified
      const approved = await ctx.gate.checkPermission(block.id, originalName, args, emitEvent, async () => {
        const r = await runHooks('PermissionRequest', block.name, { tool_input: args }, hookCtx)
        if (r.blocked || r.permissionDecision === 'deny') return false
        // like PreToolUse allow: never auto-approves a plan
        if (r.permissionDecision === 'allow' && originalName !== 'exit_plan_mode') return true
        void runHooks('Notification', '', { message: `Waiting for approval: ${block.name}` }, hookCtx)
        return undefined
      }, ruleTool)
      if (!approved) {
        await runHooks('PermissionDenied', block.name, { tool_input: args }, hookCtx)
        return fail(
          originalName === 'exit_plan_mode'
            ? 'The user did not approve the plan. Stay in plan mode: ask what to change, revise the plan, and call exit_plan_mode again.'
            : 'Tool execution denied (permission rules or user).'
        )
      }
    }

    try {
      let text: string
      let images: Anthropic.ImageBlockParam[] = []
      const cp = ctx.opts.checkpoint
      if (cp && serverName === BUILTIN_SERVER) {
        const targets = writeTargets(originalName, args, ctx.workspaceRoot)
        // Fail closed: no snapshot, no write.
        if (targets.length) {
          try {
            await snapshot(cp.dir, ctx.sessionId.split(':sub:')[0], cp.turn, targets)
          } catch (e: any) {
            return fail(`Checkpoint failed, file not modified: ${e?.message ?? e}`)
          }
        }
      }
      if (serverName === BUILTIN_SERVER && originalName === 'exit_plan_mode') {
        ctx.gate.mode = 'acceptEdits'
        await saveSettings({ permissionMode: 'acceptEdits' }) // later runs must not reset to 'plan'
        text = 'Plan approved. Plan mode is off; edits are auto-accepted. Implement the plan now.'
      } else if (serverName === BUILTIN_SERVER && originalName === 'request_user_input') {
        const question = String(args.question ?? '').trim()
        if (!question) throw new Error('"question" is required')
        const options = Array.isArray(args.options) ? args.options.map(String).slice(0, 6) : undefined
        void runHooks('Notification', '', { message: `Waiting for your answer: ${question.slice(0, 200)}` }, hookCtx)
        const answer = await askUserInput(block.id, signal, emitEvent, question, options)
        text = answer === null ? 'The user did not answer (run stopped).' : `User answered: ${answer}`
      } else if (serverName === BUILTIN_SERVER && originalName === 'spawn_agent') {
        text = await this.spawnSubagent(args, ctx, emitEvent, block.id)
      } else if (serverName === BUILTIN_SERVER) {
        text = await runBuiltin(originalName, args, { workspaceRoot: ctx.workspaceRoot, emit: emitEvent, goalId: ctx.opts.goalId, signal, runId: ctx.runId, trusted: ctx.trusted })
      } else {
        const raw = await mcpManager.executeTool(serverName, originalName, args, signal)
        if (typeof raw === 'string') text = raw
        else if (Array.isArray(raw?.content)) {
          // Images go to the model as image blocks (not base64 text); the UI gets a short placeholder.
          const parts: string[] = []
          for (const c of raw.content) {
            if (c?.type === 'image' && typeof c.data === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(c.mimeType)) {
              images.push({ type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } })
              parts.push(`[image: ${c.mimeType}, ${Math.round((c.data.length * 3) / 4 / 1024)} KB]`)
            } else if (c?.type === 'text') parts.push(String(c.text ?? ''))
            else parts.push(JSON.stringify(c))
          }
          text = parts.join('\n')
        } else text = JSON.stringify(raw?.content ?? raw)
        if (raw?.isError) {
          images = []
          throw new Error(text)
        }
      }
      let out = capToolResult(settings.enableRtkProxy ? sanitizeTerminalOutput(text) : text)
      const err = parseExecutionError(out)
      if (err.isError) out += `\n\n${buildSelfHealingPrompt(err)}`
      if (pre.additionalContext) out += `\n\n[hook] ${pre.additionalContext}`
      const post = await runHooks('PostToolUse', block.name, { tool_input: args, tool_response: out }, hookCtx)
      if (post.additionalContext) out += `\n\n[hook] ${post.additionalContext}`
      emitEvent({ type: 'tool_call_result', callId: block.id, isError: false, output: out })
      return { type: 'tool_result', tool_use_id: block.id, content: images.length ? [{ type: 'text', text: out }, ...images] : out }
    } catch (e: any) {
      const msg = capToolResult(e?.message || 'Unknown error')
      await runHooks('PostToolUseFailure', block.name, { tool_input: args, error: msg }, hookCtx)
      return fail(msg)
    }
  }
}

export const agentRunner = new AgentRunner()
