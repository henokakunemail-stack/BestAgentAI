import React, { useState, useEffect } from 'react'
import { X, Cpu, RefreshCw, Sparkles, Check, Shield, Plus, Trash2, Webhook } from 'lucide-react'
import { McpServerStatus, AgentItem, SkillItem, HookConfigItem } from '../../../../preload/index.d'
import { McpServerCard } from './McpServerCard'
import { SkillInstaller, McpAdder } from './InstallPanels'
import { ProvidersSection, Provider } from './ProvidersSection'

const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'SessionStart',
  'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact',
  'SessionEnd', 'PermissionRequest', 'PermissionDenied', 'Notification', 'StopFailure'
]
const INPUT =
  'w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-zinc-100 font-mono focus:outline-none focus:border-amber-500/60'

interface HookRow { event: string; matcher: string; command: string; timeoutMs: string }

const toRows = (cfg: HookConfigItem): HookRow[] =>
  Object.entries(cfg).flatMap(([event, defs]) =>
    (defs ?? []).map((d) => ({ event, matcher: d.matcher ?? '', command: d.command, timeoutMs: d.timeoutMs ? String(d.timeoutMs) : '' }))
  )

const fromRows = (rows: HookRow[]): HookConfigItem => {
  const cfg: HookConfigItem = {}
  for (const r of rows) {
    ;(cfg[r.event] ??= []).push({
      command: r.command.trim(),
      ...(r.matcher.trim() ? { matcher: r.matcher.trim() } : {}),
      ...(r.timeoutMs.trim() ? { timeoutMs: Number(r.timeoutMs) } : {})
    })
  }
  return cfg
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave?: () => void
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState<Provider>('anthropic')
  const [routerBaseUrl, setRouterBaseUrl] = useState('http://localhost:20128')
  const [routerApiKey, setRouterApiKey] = useState('')
  const [routerModels, setRouterModels] = useState<string[]>([])
  const [model, setModel] = useState('claude-opus-5-5')
  const [enableThinking, setEnableThinking] = useState(true)
  const [enableRtk, setEnableRtk] = useState(true)
  const [permissionMode, setPermissionMode] = useState('default')
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([])
  const [saved, setSaved] = useState(false)
  const [contextWindow, setContextWindow] = useState('200000')
  const [maxTurns, setMaxTurns] = useState('25')
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [hookRows, setHookRows] = useState<HookRow[]>([])
  const [hookMsg, setHookMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [skillMsg, setSkillMsg] = useState('')

  useEffect(() => {
    if (isOpen) {
      window.aiDesktop?.settings?.get().then((s) => {
        if (s) {
          setApiKey(s.anthropicApiKey || '')
          setProvider(s.provider === '9router' ? '9router' : 'anthropic')
          setRouterBaseUrl(s.routerBaseUrl || 'http://localhost:20128')
          setRouterApiKey(s.routerApiKey || '')
          setModel(s.model || 'claude-opus-5-5')
          setEnableThinking(s.enableThinking !== false)
          setEnableRtk(s.enableRtkProxy !== false)
          setPermissionMode(s.permissionMode || 'default')
          setContextWindow(String(s.contextWindow ?? 200000))
          setMaxTurns(String(s.maxTurns ?? 25))
          setWorkspaceRoot(s.workspaceRoot || '')
        }
      })
      window.aiDesktop?.hooks?.get().then((cfg) => cfg && setHookRows(toRows(cfg)))
      window.aiDesktop?.agents?.list().then((l) => l && setAgents(l))
      window.aiDesktop?.skills?.list().then((l) => l && setSkills(l))
      setHookMsg(null)

      window.aiDesktop?.mcp?.getStatus().then((list) => {
        if (list) setMcpServers(list)
      })
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    await window.aiDesktop?.settings?.save({
      anthropicApiKey: apiKey.trim(),
      provider,
      routerBaseUrl: routerBaseUrl.trim(),
      routerApiKey: routerApiKey.trim(),
      model,
      enableThinking,
      enableRtkProxy: enableRtk,
      permissionMode,
      // blank/garbage keeps the stored value instead of saving NaN
      ...(Number(contextWindow) >= 1000 ? { contextWindow: Math.floor(Number(contextWindow)) } : {}),
      ...(Number(maxTurns) >= 1 ? { maxTurns: Math.floor(Number(maxTurns)) } : {}),
      ...(workspaceRoot.trim() ? { workspaceRoot: workspaceRoot.trim() } : {})
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const updateRow = (i: number, patch: Partial<HookRow>) =>
    setHookRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const handleSaveHooks = async () => {
    const bad = hookRows.findIndex((r) => !r.command.trim() || (r.timeoutMs.trim() !== '' && !(Number(r.timeoutMs) > 0)))
    if (bad >= 0) {
      setHookMsg({ ok: false, text: `Hook #${bad + 1}: command is required and timeout must be a positive number.` })
      return
    }
    const res = await window.aiDesktop?.hooks?.save(fromRows(hookRows))
    setHookMsg(res && 'error' in res ? { ok: false, text: res.error } : res ? { ok: true, text: 'Hooks saved.' } : { ok: false, text: 'Save failed.' })
  }

  const refreshSkills = () => window.aiDesktop?.skills?.list().then((l) => l && setSkills(l))

  const handleRemoveSkill = async (name: string) => {
    const ok = await window.aiDesktop?.skills?.remove(name).catch(() => false)
    setSkillMsg(ok ? `Removed /${name}.` : `/${name} was not installed by this app; delete its folder by hand.`)
    refreshSkills()
  }

  const handleRemoveMcp = async (name: string) => {
    if (!window.confirm(`Remove MCP server "${name}"?`)) return
    const updated = await window.aiDesktop?.mcp?.remove(name)
    if (updated) setMcpServers(updated)
  }

  const handleReloadMcp = async () => {
    const updated = await window.aiDesktop?.mcp?.reloadConfig()
    if (updated) setMcpServers(updated)
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 select-none">
      <div className="bg-zinc-950 border border-zinc-700/80 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-12 px-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Cpu className="w-4 h-4 text-amber-500" />
            <span>AI Desktop Settings & Runtimes</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          <ProvidersSection
            provider={provider}
            setProvider={setProvider}
            apiKey={apiKey}
            setApiKey={setApiKey}
            routerBaseUrl={routerBaseUrl}
            setRouterBaseUrl={setRouterBaseUrl}
            routerApiKey={routerApiKey}
            setRouterApiKey={setRouterApiKey}
            onModels={setRouterModels}
          />

          {/* Model selection */}
          <div className="space-y-1.5">
            <label className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>{provider === '9router' ? 'Model (from 9router)' : 'Claude Model Architecture'}</span>
            </label>
            {provider === '9router' ? (
              <>
                <input list="router-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. cx/gpt-5 or ag/gemini-3-pro" className={INPUT} />
                <datalist id="router-models">
                  {routerModels.map((m) => <option key={m} value={m} />)}
                </datalist>
              </>
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-zinc-100 font-mono focus:outline-none"
              >
                <option value="claude-opus-5-5">claude-opus-5-5 (Highest capability, adaptive thinking)</option>
                <option value="claude-sonnet-5-5">claude-sonnet-5-5 (High speed, strong code synthesis)</option>
                <option value="claude-haiku-5-5">claude-haiku-5-5 (Ultra fast, lightweight)</option>
              </select>
            )}
          </div>

          {/* Permission mode */}
          <div className="space-y-1.5">
            <label className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-amber-500" />
              <span>Permission Mode</span>
            </label>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-zinc-100 font-mono focus:outline-none"
            >
              <option value="default">default (ask before write/exec)</option>
              <option value="acceptEdits">acceptEdits (auto-allow file edits)</option>
              <option value="plan">plan (read-only, no changes)</option>
              <option value="dontAsk">dontAsk (deny anything not pre-allowed, never prompt)</option>
              <option value="bypass">bypass (no prompts - dangerous)</option>
            </select>
          </div>

          {/* Feature toggles */}
          <div className="space-y-2 border-t border-zinc-800/80 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-zinc-200 font-medium">Adaptive Thinking Process</div>
                <div className="text-zinc-500 text-[11px]">Stream internal reasoning thoughts in accordion</div>
              </div>
              <input
                type="checkbox"
                checked={enableThinking}
                onChange={(e) => setEnableThinking(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-600 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-zinc-200 font-medium">RTK Token Killer Output Proxy</div>
                <div className="text-zinc-500 text-[11px]">Filter ANSI escapes & strip build noise (saves 70%+ tokens)</div>
              </div>
              <input
                type="checkbox"
                checked={enableRtk}
                onChange={(e) => setEnableRtk(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Limits & workspace */}
          <div className="border-t border-zinc-800/80 pt-4 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-zinc-300 font-medium">Context window (tokens)</label>
              <input type="number" min={1000} value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} className={INPUT} />
              <div className="text-zinc-500 text-[11px]">Auto-compaction triggers at 80%.</div>
            </div>
            <div className="space-y-1.5">
              <label className="text-zinc-300 font-medium">Max turns per run</label>
              <input type="number" min={1} value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} className={INPUT} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <label className="text-zinc-300 font-medium">Workspace root</label>
              <input value={workspaceRoot} onChange={(e) => setWorkspaceRoot(e.target.value)} placeholder="C:\path\to\project" className={INPUT} />
              <div className="text-zinc-500 text-[11px]">File tools, skills, agents and custom commands resolve against this folder.</div>
            </div>
          </div>

          {/* Hooks */}
          <div className="border-t border-zinc-800/80 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                <Webhook className="w-3.5 h-3.5 text-amber-500" />
                Hooks
              </span>
              <button
                type="button"
                onClick={() => setHookRows((r) => [...r, { event: 'PreToolUse', matcher: '', command: '', timeoutMs: '' }])}
                className="flex items-center gap-1 px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-[11px] text-zinc-300 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>Add hook</span>
              </button>
            </div>
            <div className="text-zinc-500 text-[11px]">
              Shell command per event; JSON payload on stdin. Exit code 2 blocks. Matcher is a regex on the tool name (empty = all).
            </div>
            {hookRows.length === 0 && (
              <div className="p-3 bg-zinc-900/40 rounded border border-zinc-800 text-zinc-500 text-center">No hooks configured</div>
            )}
            {hookRows.map((r, i) => (
              <div key={i} className="p-2.5 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-2">
                <div className="flex gap-2">
                  <select value={r.event} onChange={(e) => updateRow(i, { event: e.target.value })} className={INPUT + ' flex-1'}>
                    {HOOK_EVENTS.map((ev) => (
                      <option key={ev} value={ev}>{ev}</option>
                    ))}
                  </select>
                  <input value={r.matcher} onChange={(e) => updateRow(i, { matcher: e.target.value })} placeholder="matcher (regex)" className={INPUT + ' flex-1'} />
                  <input value={r.timeoutMs} onChange={(e) => updateRow(i, { timeoutMs: e.target.value })} placeholder="timeout ms" className={INPUT + ' w-28'} />
                  <button
                    type="button"
                    onClick={() => setHookRows((rows) => rows.filter((_, j) => j !== i))}
                    className="p-2 hover:bg-zinc-800 rounded text-zinc-500 hover:text-red-400"
                    title="Remove hook"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input value={r.command} onChange={(e) => updateRow(i, { command: e.target.value })} placeholder="command, e.g. node scripts/guard.js" className={INPUT} />
              </div>
            ))}
            <div className="flex items-center justify-between">
              <span className={`text-[11px] ${hookMsg?.ok ? 'text-emerald-400' : 'text-red-400'}`}>{hookMsg?.text}</span>
              <button
                type="button"
                onClick={handleSaveHooks}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-md transition-colors text-[11px]"
              >
                Save hooks
              </button>
            </div>
          </div>

          {/* Agents & skills (read-only; files on disk are the source of truth) */}
          <div className="border-t border-zinc-800/80 pt-4 space-y-2">
            <span className="text-zinc-300 font-medium">Subagents ({agents.length})</span>
            {agents.length === 0 ? (
              <div className="p-3 bg-zinc-900/40 rounded border border-zinc-800 text-zinc-500 text-center">
                None. Add <span className="font-mono">.claude/agents/&lt;name&gt;.md</span> in the workspace.
              </div>
            ) : (
              agents.map((a) => (
                <div key={a.name} className="p-2 bg-zinc-900/40 rounded border border-zinc-800">
                  <div className="font-mono text-zinc-200">
                    {a.name}
                    <span className="ml-2 text-[10px] text-zinc-500">
                      {a.tools ? `${a.tools.length} tools` : 'all tools'}
                      {a.model ? ` · ${a.model}` : ''}
                    </span>
                  </div>
                  <div className="text-zinc-500 text-[11px] truncate">{a.description}</div>
                </div>
              ))
            )}
            <div className="flex items-center justify-between pt-2">
              <span className="text-zinc-300 font-medium">Skills ({skills.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((k) => (
                <span key={k.name} title={k.description} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-zinc-300 font-mono inline-flex items-center gap-1">
                  /{k.name}
                  <button type="button" title="Remove (only skills installed by this app)" onClick={() => handleRemoveSkill(k.name)} className="text-zinc-500 hover:text-red-400">×</button>
                </span>
              ))}
              {skills.length === 0 && <span className="text-zinc-500">No skills found.</span>}
            </div>
            {skillMsg && <div className="text-amber-400 text-[11px]">{skillMsg}</div>}
            <SkillInstaller hasWorkspace={!!workspaceRoot} onDone={refreshSkills} />
          </div>

          {/* Standard MCP Servers */}
          <div className="border-t border-zinc-800/80 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 font-medium">Configured MCP Servers</span>
              <button
                type="button"
                onClick={handleReloadMcp}
                className="flex items-center gap-1 px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-[11px] text-zinc-300 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reload Servers</span>
              </button>
            </div>

            <div className="space-y-2">
              {mcpServers.length === 0 ? (
                <div className="p-3 bg-zinc-900/40 rounded border border-zinc-800 text-zinc-500 text-center text-xs">
                  No custom stdio MCP servers connected yet
                </div>
              ) : (
                mcpServers.map((s) => <McpServerCard key={s.name} server={s} onRemove={handleRemoveMcp} />)
              )}
            </div>
            <McpAdder onDone={setMcpServers} />
          </div>
        </div>

        {/* Footer */}
        <div className="h-12 px-5 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
          <span className="text-emerald-400 text-xs flex items-center gap-1">
            {saved && (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Settings Saved</span>
              </>
            )}
          </span>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-md transition-colors shadow-sm"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
