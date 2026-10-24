import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { isSessionId, validateSettingsPatch, maskSecrets, SECRET_MASK, isSafeExternalUrl } from './validate'
import { normalizeBaseUrl, parseModelIds, isLoopback } from '../agent/clientFactory'
import { IPC_CHANNELS } from './channels'
import { getMainWindow } from '../windows/mainWindow'
import { toggleLauncherWindow } from '../windows/launcherWindow'
import { agentRunner } from '../agent/agentRunner'
import { PermissionGate } from '../mcp/permissionGate'
import { mcpManager } from '../mcp/mcpClientManager'
import { reaClient } from '../mcp/reaClient'
import { getGoals, addGoal, toggleGoal, deleteGoal, updateGoal, GoalStatus } from '../storage/goalsStore'
import { randomBytes } from 'node:crypto'
import { readDesktopConfig, addServerConfigs, removeServerConfig, McpServerConfig } from '../mcp/configWatcher'
import { parseMcpSnippet, maskConfig, isSafeSkillName } from '../install/githubSource'
import { inspectSkillSource, installSkills, removeSkill, inspectMcpSource, discard as discardSkillInstall } from '../install/skillInstaller'
import { isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import { enqueue, dequeue, clearQueue } from '../storage/queueStore'
import { getMemories, addMemory, deleteMemory } from '../storage/memoryStore'
import { listSessions, getSession, saveSession, createSession, deleteSession } from '../storage/threadStore'
import { getSettings, saveSettings } from '../storage/settingsStore'
import { terminalManager } from '../terminal/ptyManager'
import { skillsLoader } from '../agent/skillsLoader'
import { parseSlash, isBuiltin, expandCustomCommand, estimateCost, listCommands, UsageTotals } from '../agent/slashCommands'
import { loadAgents } from '../agent/agentsLoader'
import { isWorkspaceTrusted, setWorkspaceTrusted } from '../agent/trust'
import { buildUserContent, textOf } from '../agent/attachments'
import { globTool } from '../agent/fileTools'
import { checkpointDir, beginTurn, listTurns, restore as restoreCheckpoint, dropSession } from '../agent/checkpoints'
import { runHooks, validateHookConfig, HookConfig } from '../agent/hooks'
import { readJson, writeJson } from '../storage/db'

export function registerIpcHandlers(): () => Promise<void> {
  // Window controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_HIDE_LAUNCHER, () => {
    toggleLauncherWindow()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_SHOW_MAIN, () => {
    const win = getMainWindow()
    win?.show()
    win?.focus()
  })

  ipcMain.on(IPC_CHANNELS.WINDOW_LAUNCHER_SUBMIT, (_, query: string) => {
    const win = getMainWindow()
    if (!win || typeof query !== 'string' || !query.trim()) return
    win.show()
    win.focus()
    win.webContents.send(IPC_CHANNELS.WINDOW_LAUNCHER_PROMPT, query)
  })

  // Chat & Agent Loop (Codex: queued items + goal continuation)
  const busy = new Set<string>()
  const aborted = new Set<string>() // sessions the user stopped: loop must not dequeue or continue goals
  const startCtx = new Map<string, string>() // sessions whose SessionStart hook already ran -> its additionalContext
  const cleared = new Set<string>() // next SessionStart for these has source "clear"
  const usage = new Map<string, UsageTotals>() // per-session token totals for /cost (since app start)
  const runGoal = new Map<string, string>() // session -> goal its current run is working on (Stop pauses only that one)
  const MAX_CONTINUATIONS = 20
  const MODES = ['default', 'acceptEdits', 'plan', 'bypass', 'dontAsk'] as const
  /** Workspace root when trusted, else undefined (only user-level skills/agents/commands load). */
  const trustedRoot = async (): Promise<string | undefined> => {
    const { workspaceRoot } = await getSettings()
    return (await isWorkspaceTrusted(workspaceRoot).catch(() => false)) ? workspaceRoot : undefined
  }
  const zero = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

  ipcMain.handle(IPC_CHANNELS.CHAT_SEND_MESSAGE, async (event, params) => {
    const { sessionId, prompt } = params ?? {}
    if (typeof prompt !== 'string' || !prompt.trim()) return { success: false, error: 'prompt must be a non-empty string' }
    // Claim the session before any await: a Stop that arrives while the session file is still loading must find it busy.
    if (isSessionId(sessionId)) {
      if (busy.has(sessionId)) return { success: true, sessionId, queued: await enqueue(sessionId, prompt) }
      busy.add(sessionId)
      aborted.delete(sessionId)
    }
    let session: Awaited<ReturnType<typeof getSession>> = null
    try {
      session = isSessionId(sessionId) ? await getSession(sessionId) : null
      if (!session) {
        if (isSessionId(sessionId)) busy.delete(sessionId)
        const newId = await createSession()
        session = (await getSession(newId))!
        busy.add(newId)
        aborted.delete(newId)
      }
    } catch (e: any) {
      // Corrupt session file: say so instead of silently starting a fresh chat over it.
      if (isSessionId(sessionId)) busy.delete(sessionId)
      event.sender.send(IPC_CHANNELS.CHAT_STREAM_EVENT, { sessionId, type: 'error', error: e.message })
      return { success: false, error: e.message }
    }
    const sid = session.id

    const emitEvent = (data: any) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.CHAT_STREAM_EVENT, { sessionId: sid, ...data })
    }
    const emitUsage = async () => {
      const u = usage.get(sid) ?? zero()
      emitEvent({ type: 'usage', usage: { ...u, cost: estimateCost((await getSettings()).model, u) } })
    }

    /** Handles slash commands. Returns the prompt to send to the model, or undefined when fully handled here. */
    const resolvePrompt = async (raw: string): Promise<string | undefined> => {
      const slash = parseSlash(raw)
      if (!slash) return raw
      const settings = await getSettings()
      const wsRoot = await trustedRoot()
      if (!isBuiltin(slash.name)) {
        const expanded = await expandCustomCommand(slash.name, slash.args, wsRoot)
        return expanded ?? raw // not a command (could be a /skill): send as written
      }
      const say = (text: string) => { emitEvent({ type: 'text', delta: text }); emitEvent({ type: 'done' }) }
      const reset = (text: string) => { emitEvent({ type: 'session_reset', delta: text }); emitEvent({ type: 'done' }) }
      try {
        switch (slash.name) {
          case 'clear':
            await runHooks('SessionEnd', '', { reason: 'clear' }, { sessionId: sid, cwd: settings.workspaceRoot }).catch(() => {})
            session!.messages = []
            await saveSession(session!)
            usage.delete(sid)
            await dropSession(await checkpointDir(), sid).catch(() => {})
            startCtx.delete(sid)
            cleared.add(sid)
            reset('Context cleared.')
            await emitUsage()
            break
          case 'rewind': {
            const cpDir = await checkpointDir()
            // a turn is valid only while its user message is still at that index (compaction/clear renumber messages)
            const valid = (await listTurns(cpDir, sid)).filter((t) => {
              const m = session!.messages[t.turn]
              return m?.role === 'user' && textOf(m.content).startsWith(t.preview)
            }).reverse() // newest first
            if (!slash.args) {
              say(valid.length ? valid.map((t, i) => `${i + 1}. ${t.preview.replace(/\s+/g, ' ')} (${t.files} file${t.files === 1 ? '' : 's'})`).join('\n') + '\n\n/rewind <n> undoes the n most recent prompts. Files changed via bash are not tracked.' : 'No checkpoints for this session.')
              break
            }
            const n = Number(slash.args)
            if (!Number.isInteger(n) || n < 1 || n > valid.length) { say(`Usage: /rewind <1-${valid.length}>`); break }
            const target = valid[n - 1].turn
            const { files } = await restoreCheckpoint(cpDir, sid, valid.filter((t) => t.turn >= target).map((t) => t.turn))
            session!.messages = session!.messages.slice(0, target)
            await saveSession(session!)
            reset(`Rewound ${n} prompt${n === 1 ? '' : 's'}; ${files} file${files === 1 ? '' : 's'} restored.`)
            break
          }
          case 'compact': {
            const out = await agentRunner.compactNow(session!.messages, slash.args)
            if (out === session!.messages) say('Nothing to compact yet.')
            else { session!.messages = out; await saveSession(session!); reset(`Compacted to ${out.length} messages.`) }
            break
          }
          case 'model':
            if (slash.args) await saveSettings({ model: slash.args })
            emitEvent({ type: 'settings_changed' })
            say(`Model: ${slash.args || settings.model}`)
            break
          case 'plan':
            await saveSettings({ permissionMode: 'plan' })
            emitEvent({ type: 'settings_changed' })
            say('Plan mode on. The agent will explore read-only and ask for approval before editing.')
            break
          case 'permissions':
            if (!slash.args) say(`Permission mode: ${settings.permissionMode}. Options: ${MODES.join(', ')}`)
            else if (!(MODES as readonly string[]).includes(slash.args)) say(`Unknown mode "${slash.args}". Options: ${MODES.join(', ')}`)
            else {
              await saveSettings({ permissionMode: slash.args as (typeof MODES)[number] })
              emitEvent({ type: 'settings_changed' })
              say(`Permission mode: ${slash.args}`)
            }
            break
          case 'cost': {
            const u = usage.get(sid) ?? zero()
            const c = estimateCost(settings.model, u)
            say(`Tokens in ${u.input}, out ${u.output}, cache read ${u.cacheRead}, cache write ${u.cacheWrite}. ${c === null ? 'Cost: unknown model pricing.' : `Estimated cost: $${c.toFixed(4)}`}`)
            break
          }
          case 'skills': {
            const list = await skillsLoader.loadAllSkills(wsRoot)
            say(list.length ? list.map((s) => `- /${s.name}: ${s.description.slice(0, 120)}`).join('\n') : 'No skills found.')
            break
          }
          case 'agents': {
            const list = await loadAgents(wsRoot)
            say(list.length ? list.map((a) => `- ${a.name}${a.tools ? ` [${a.tools.length} tools]` : ''}: ${a.description.slice(0, 120)}`).join('\n') : 'No agents found. Add .claude/agents/<name>.md')
            break
          }
          case 'mcp': {
            const list = mcpManager.getStatus()
            say(list.length ? list.map((s) => `- ${s.name}: ${s.status}, ${s.toolsCount} tools${s.error ? ` (${s.error})` : ''}`).join('\n') : 'No MCP servers configured.')
            break
          }
        }
      } catch (e: any) {
        emitEvent({ type: 'error', error: e?.message ?? String(e) })
        emitEvent({ type: 'done' })
      }
      return undefined
    }

    try {
      let pending: string | undefined = prompt
      let continuations = 0
      while (pending !== undefined) {
        const next = await resolvePrompt(pending)
        if (next) {
          if (session.messages.length === 0) session.title = next.slice(0, 36)

          if (!startCtx.has(sid)) {
            const settings = await getSettings()
            const source = cleared.delete(sid) ? 'clear' : session.messages.length ? 'resume' : 'startup'
            const r = await runHooks('SessionStart', '', { source }, { sessionId: sid, cwd: settings.workspaceRoot })
            startCtx.set(sid, r.additionalContext ?? '')
          }

          const turn = session.messages.length
          const cpDir = await checkpointDir()
          await beginTurn(cpDir, sid, turn, next).catch((e) => console.warn('[checkpoints] beginTurn failed:', e))
          // "@path" tokens become <file>/image blocks at send time, so the queue keeps plain strings
          const content = await buildUserContent(next, (await getSettings()).workspaceRoot)
          session.messages.push({ role: 'user', content })
          await saveSession(session) // persist the prompt before the run: a crash mid-run no longer loses it
          if (aborted.has(sid)) {
            // Stop arrived while the turn was being prepared: do not start the run, but let the UI leave its streaming state
            emitEvent({ type: 'aborted' })
            emitEvent({ type: 'done' })
            break
          }
          const goal = (await getGoals()).find((g) => g.status === 'active')
          if (goal) runGoal.set(sid, goal.id)
          let used = 0
          session.messages = await agentRunner.run(session.messages, emitEvent, sid, {
            goalId: goal?.id,
            extraSystem: startCtx.get(sid) || undefined,
            checkpoint: { dir: cpDir, turn },
            onUsage: (t) => (used += t),
            onUsageDetail: (d) => {
              const u = usage.get(sid) ?? zero()
              usage.set(sid, { input: u.input + d.input, output: u.output + d.output, cacheRead: u.cacheRead + d.cacheRead, cacheWrite: u.cacheWrite + d.cacheWrite })
            }
          })
          await saveSession(session)
          await emitUsage()
          if (goal) {
            const cur = (await getGoals()).find((g) => g.id === goal.id)
            if (cur) await updateGoal(goal.id, { tokensUsed: cur.tokensUsed + used })
          }
        }

        if (aborted.has(sid)) break // user stop wins over the queue and goal continuation

        pending = await dequeue(sid)
        if (pending !== undefined) continue
        if (!next) break // a slash command ran: nothing to continue

        // Goal continuation: re-prompt while a goal stays active and within budget
        const active = (await getGoals()).find((g) => g.status === 'active')
        if (!active) break
        if (active.tokensUsed >= active.tokenBudget) {
          await updateGoal(active.id, { status: 'budget_limited' })
          emitEvent({ type: 'goal_update', goalId: active.id, status: 'budget_limited' })
        } else if (continuations++ < MAX_CONTINUATIONS) {
          pending = `Continue working toward the active goal: "${active.text}". If it is fully achieved and verified, call builtin__update_goal with status "complete". If you need the user, call it with "blocked".`
        } else {
          await updateGoal(active.id, { status: 'paused', note: 'continuation limit reached' })
        }
      }
    } finally {
      busy.delete(sid)
      aborted.delete(sid)
      runGoal.delete(sid)
    }
    return { success: true, sessionId: sid }
  })

  ipcMain.on(IPC_CHANNELS.CHAT_ABORT, async (_, sessionId: string) => {
    if (!isSessionId(sessionId)) return
    if (busy.has(sessionId)) aborted.add(sessionId)
    agentRunner.abort(sessionId)
    // user stop wins: drop queue and pause the goal so the loop does not resume
    await clearQueue(sessionId)
    const goalId = runGoal.get(sessionId)
    if (goalId) await updateGoal(goalId, { status: 'paused' }) // only the goal this session was running; other sessions' goals keep going
  })

  ipcMain.on(IPC_CHANNELS.TOOL_CONFIRM_DECISION, (_, { callId, approved, always }) => {
    PermissionGate.resolveDecision(callId, approved, !!always)
  })

  ipcMain.on(IPC_CHANNELS.USER_INPUT_ANSWER, (_, { callId, answer }) => {
    PermissionGate.resolveInput(String(callId), String(answer ?? ''))
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_LIST_SESSIONS, async () => {
    return await listSessions()
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_GET_HISTORY, async (_, sessionId) => {
    if (!isSessionId(sessionId)) return null
    return await getSession(sessionId).catch(() => null)
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_NEW_SESSION, async () => {
    return await createSession()
  })

  ipcMain.handle(IPC_CHANNELS.CHAT_DELETE_SESSION, async (_, sessionId) => {
    if (!isSessionId(sessionId)) return false
    // A running turn would save the session again after the delete: stop it and wait (bounded) until it let go.
    if (busy.has(sessionId)) {
      aborted.add(sessionId)
      agentRunner.abort(sessionId)
      for (let i = 0; i < 50 && busy.has(sessionId); i++) await new Promise((r) => setTimeout(r, 100))
    }
    await clearQueue(sessionId).catch(() => {})
    await dropSession(await checkpointDir(), sessionId).catch(() => {})
    await runHooks('SessionEnd', '', { reason: 'delete' }, { sessionId, cwd: (await getSettings()).workspaceRoot }).catch(() => {})
    for (const m of [usage, startCtx, runGoal] as Array<Map<string, unknown>>) m.delete(sessionId)
    for (const s of [cleared, aborted]) s.delete(sessionId)
    return await deleteSession(sessionId)
  })

  // MCP Manager
  ipcMain.handle(IPC_CHANNELS.MCP_GET_STATUS, () => {
    return mcpManager.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.MCP_RELOAD_CONFIG, async () => {
    await mcpManager.initialize()
    return mcpManager.getStatus()
  })

  // MCP install: the renderer only ever sees masked previews; the add step needs the one-shot token from the preview.
  const mcpPending = new Map<string, { servers: Record<string, McpServerConfig>; timer: NodeJS.Timeout }>()
  const dropMcpPending = (t: string): void => {
    clearTimeout(mcpPending.get(t)?.timer)
    mcpPending.delete(t)
  }
  const asText = (v: unknown, max: number): string => {
    if (typeof v !== 'string' || v.length > max) throw new Error('invalid input')
    return v
  }
  ipcMain.handle(IPC_CHANNELS.MCP_PREVIEW, async (_, p: { text: string; name?: string }) => {
    const name = p?.name?.trim() || 'server'
    const servers = parseMcpSnippet(asText(p?.text, 256 * 1024), isSafeSkillName(name) ? name : 'server')
    const current = (await readDesktopConfig()).mcpServers ?? {}
    const token = randomBytes(16).toString('hex')
    const timer = setTimeout(() => dropMcpPending(token), 5 * 60_000)
    timer.unref?.()
    mcpPending.set(token, { servers, timer })
    return { token, servers: Object.entries(servers).map(([n, c]) => ({ name: n, ...maskConfig(c), replaces: n in current })) }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_ADD, async (_, token: string) => {
    const p = mcpPending.get(token)
    if (!p) throw new Error('preview expired, paste the config again')
    dropMcpPending(token)
    await addServerConfigs(p.servers)
    await mcpManager.initialize()
    return mcpManager.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.MCP_REMOVE, async (_, name: string) => {
    if (!isSafeSkillName(asText(name, 64))) throw new Error('bad server name')
    await removeServerConfig(name)
    await mcpManager.initialize()
    return mcpManager.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.MCP_INSPECT_GITHUB, async (_, url: string) => inspectMcpSource(asText(url, 500)))

  // MCP REA
  ipcMain.handle(IPC_CHANNELS.REA_GET_STATUS, async () => {
    return await reaClient.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.REA_INITIALIZE, async () => {
    return await reaClient.initialize()
  })

  ipcMain.handle(IPC_CHANNELS.REA_EXECUTE, async (_, { tool, args }) => {
    return await reaClient.executeTool(tool, args)
  })

  // Goals (Codex)
  ipcMain.handle(IPC_CHANNELS.GOALS_GET_ALL, async () => {
    return await getGoals()
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_ADD, async (_, text) => {
    return await addGoal(text)
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_TOGGLE, async (_, id) => {
    return await toggleGoal(id)
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_SET_STATUS, async (_, { id, status }: { id: string; status: GoalStatus }) => {
    return await updateGoal(id, { status })
  })

  ipcMain.handle(IPC_CHANNELS.GOALS_DELETE, async (_, id) => {
    return await deleteGoal(id)
  })

  // Memory (Codex)
  ipcMain.handle(IPC_CHANNELS.MEMORY_GET_ALL, async () => {
    return await getMemories()
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_ADD, async (_, { key, value }) => {
    return await addMemory(key, value)
  })

  ipcMain.handle(IPC_CHANNELS.MEMORY_DELETE, async (_, id) => {
    return await deleteMemory(id)
  })

  // Terminal PTY (Claude Code)
  ipcMain.handle(IPC_CHANNELS.TERMINAL_SPAWN, async (event) => {
    const sender = event.sender
    terminalManager.onOutput((data) => {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.TERMINAL_OUTPUT, data)
    })
    if (terminalManager.isAlive()) return true // reopening the panel keeps the shell and its history
    const root = (await getSettings()).workspaceRoot
    terminalManager.spawnTerminal(root && isAbsolute(root) && existsSync(root) ? root : undefined)
    return true
  })

  ipcMain.on(IPC_CHANNELS.TERMINAL_INPUT, (_, data) => {
    terminalManager.write(data)
  })

  // Skills
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async () => {
    return await skillsLoader.loadAllSkills(await trustedRoot())
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_INSPECT_GITHUB, async (_, url: string) => inspectSkillSource(asText(url, 500), await trustedRoot()))
  ipcMain.handle(IPC_CHANNELS.SKILLS_INSTALL, async (_, p: { token: string; names: string[]; scope: 'user' | 'workspace'; overwrite: boolean }) => {
    if (!Array.isArray(p?.names) || p.names.length > 50 || p.names.some((n) => typeof n !== 'string')) throw new Error('invalid input')
    return await installSkills(asText(p.token, 64), p.names, p.scope === 'workspace' ? 'workspace' : 'user', p.overwrite === true, await trustedRoot())
  })
  ipcMain.handle(IPC_CHANNELS.SKILLS_DISCARD, async (_, token: string) => discardSkillInstall(asText(token, 64)))
  ipcMain.handle(IPC_CHANNELS.SKILLS_REMOVE, async (_, name: string) => removeSkill(asText(name, 64), await trustedRoot()))

  ipcMain.handle(IPC_CHANNELS.COMMANDS_LIST, async () => {
    const root = await trustedRoot()
    return await listCommands(root, await skillsLoader.loadAllSkills(root))
  })

  ipcMain.handle(IPC_CHANNELS.AGENTS_LIST, async () => {
    const agents = await loadAgents(await trustedRoot())
    return agents.map(({ prompt: _p, ...a }) => a)
  })

  // "@" file autocomplete: workspace file list cached 5 s (the glob walk stats every file)
  let fileCache: { root: string; at: number; files: string[] } | undefined
  ipcMain.handle(IPC_CHANNELS.FILES_COMPLETE, async (_, query: string) => {
    const root = (await getSettings()).workspaceRoot
    if (!fileCache || fileCache.root !== root || Date.now() - fileCache.at > 5000) {
      const out = await globTool(root, { pattern: '**' })
      fileCache = { root, at: Date.now(), files: out === 'No files matched.' ? [] : out.split('\n').filter((l) => !l.startsWith('[...')) }
    }
    const q = String(query ?? '').toLowerCase()
    return fileCache.files.filter((f) => f.toLowerCase().includes(q)).slice(0, 8)
  })

  // Trust (per workspace folder)
  ipcMain.handle(IPC_CHANNELS.TRUST_GET, async () => {
    const root = (await getSettings()).workspaceRoot
    return { root, trusted: await isWorkspaceTrusted(root) }
  })

  ipcMain.handle(IPC_CHANNELS.TRUST_SET, async (_, trusted: boolean) => {
    const root = (await getSettings()).workspaceRoot
    await setWorkspaceTrusted(root, !!trusted)
    return { root, trusted: !!trusted }
  })

  // Providers. Login itself happens in the provider's own page / the 9router dashboard; this app never sees those tokens.
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_TEST, async (_, baseUrl: string, apiKeyIn: string) => {
    const apiKey = apiKeyIn === SECRET_MASK ? (await getSettings()).routerApiKey : String(apiKeyIn ?? '')
    let base: string
    try {
      base = normalizeBaseUrl(String(baseUrl))
    } catch (e: any) {
      return { ok: false as const, error: e.message }
    }
    try {
      const res = await fetch(`${base}/v1/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(8000)
      })
      if (res.status === 401 || res.status === 403) return { ok: false as const, error: `${res.status}: API key missing or wrong. Create one in the 9router dashboard (Keys).` }
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
      return { ok: true as const, models: parseModelIds(await res.json().catch(() => null)) }
    } catch (e: any) {
      return { ok: false as const, error: `Cannot reach ${base}: ${e?.cause?.code ?? e?.message ?? 'unknown error'}` }
    }
  })

  // Fixed targets only: never opens a URL taken from the renderer (router base URL is re-validated).
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_OPEN, async (_, target: string, baseUrl?: string) => {
    try {
      const url =
        target === 'claude' ? 'https://console.anthropic.com/settings/keys'
        : target === 'openai' ? 'https://platform.openai.com/api-keys'
        : target === 'router' ? `${normalizeBaseUrl(String(baseUrl || (await getSettings()).routerBaseUrl))}/dashboard`
        : null
      if (!url) return { ok: false, error: `unknown target ${target}` }
      // https anywhere, or http only for a loopback gateway (default 9router)
      if (!isSafeExternalUrl(url) && !isLoopback(url)) return { ok: false, error: 'blocked url' }
      await shell.openExternal(url)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // Hooks
  ipcMain.handle(IPC_CHANNELS.HOOKS_GET, async () => readJson<HookConfig>('hooks.json', {}))

  ipcMain.handle(IPC_CHANNELS.HOOKS_SAVE, async (_, cfg: unknown) => {
    const error = validateHookConfig(cfg)
    if (error) return { ok: false, error }
    await writeJson('hooks.json', cfg)
    return { ok: true }
  })

  // Settings
  // Secrets never reach the renderer: it sees a mask, and sending the mask back keeps the stored value.
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => maskSecrets(await getSettings()))

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, async (_, data) => {
    const v = validateSettingsPatch(data)
    if ('error' in v) throw new Error(v.error)
    // Bypass disables every permission prompt: require a native confirmation that page script cannot click.
    if (v.patch.permissionMode === 'bypass' && (await getSettings()).permissionMode !== 'bypass') {
      const win = getMainWindow()
      const opts = { type: 'warning' as const, buttons: ['Cancel', 'Enable bypass'], defaultId: 0, cancelId: 0, title: 'Disable permission prompts?', message: 'Bypass mode lets the agent run commands and edit files without asking.' }
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      if (response !== 1) delete v.patch.permissionMode
    }
    return maskSecrets(await saveSettings(v.patch as any))
  })

  /** App is closing: stop running turns and fire SessionEnd for every session that ran SessionStart. */
  return async function endAllSessions(): Promise<void> {
    agentRunner.abortAll()
    for (const s of busy) aborted.add(s)
    const cwd = (await getSettings().catch(() => null))?.workspaceRoot
    await Promise.all([...startCtx.keys()].map((sessionId) => runHooks('SessionEnd', '', { reason: 'exit' }, { sessionId, cwd }).catch(() => {})))
  }
}
