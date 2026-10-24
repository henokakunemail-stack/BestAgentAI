import React, { useState } from 'react'
import { Download, AlertTriangle, X } from 'lucide-react'
import type { SkillInspect, McpPreview, McpServerStatus } from '../../../../preload/index.d'

const INPUT = 'w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-zinc-100 font-mono focus:outline-none focus:border-amber-500/60'
const BTN = 'px-2.5 py-1 rounded border text-[11px] transition-colors disabled:opacity-50'
const msgOf = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const kb = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** "Install from GitHub": URL -> shallow clone preview (main) -> user reads SKILL.md and approves -> copy. */
export const SkillInstaller: React.FC<{ onDone: () => void; hasWorkspace: boolean }> = ({ onDone, hasWorkspace }) => {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<SkillInspect | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<'user' | 'workspace'>('user')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const close = (): void => {
    if (info) void window.aiDesktop?.skills?.discard(info.token)
    setInfo(null); setPicked(new Set()); setMsg(null); setOpen(false)
  }
  const inspect = async (): Promise<void> => {
    setBusy(true); setMsg(null)
    try {
      const r = await window.aiDesktop!.skills.inspectGithub(url.trim())
      setInfo(r)
      setPicked(new Set(r.candidates.length === 1 ? [r.candidates[0].name] : []))
    } catch (e) { setMsg({ ok: false, text: msgOf(e) }) }
    setBusy(false)
  }
  const install = async (): Promise<void> => {
    if (!info) return
    setBusy(true)
    try {
      const done = await window.aiDesktop!.skills.install(info.token, [...picked], scope, info.candidates.some((c) => picked.has(c.name) && c.exists))
      setInfo(null); setPicked(new Set()); setMsg({ ok: true, text: `Installed: ${done.map((n) => '/' + n).join(', ')}` })
      onDone()
    } catch (e) { setMsg({ ok: false, text: msgOf(e) }); setInfo(null) }
    setBusy(false)
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${BTN} bg-zinc-900 hover:bg-zinc-800 border-zinc-700/80 text-zinc-300 inline-flex items-center gap-1`}>
        <Download className="w-3 h-3" /> Install from GitHub
      </button>
    )
  }
  return (
    <div className="p-3 bg-zinc-900/60 border border-zinc-700/60 rounded-lg space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium">Install skill from GitHub</span>
        <button type="button" onClick={close} className="text-zinc-500 hover:text-zinc-300"><X className="w-3.5 h-3.5" /></button>
      </div>
      {!info ? (
        <div className="flex gap-2">
          <input className={INPUT} placeholder="https://github.com/owner/repo[/tree/main/skills/name]" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="button" disabled={busy || !url.trim()} onClick={inspect} className={`${BTN} bg-amber-500/90 hover:bg-amber-400 border-amber-500 text-zinc-950 font-semibold whitespace-nowrap`}>
            {busy ? 'Cloning...' : 'Inspect'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-zinc-500 text-[11px] font-mono truncate">{info.url} @ {info.sha.slice(0, 8)}</div>
          {info.candidates.map((c) => (
            <label key={c.name} className="block p-2 bg-zinc-950 rounded border border-zinc-800 cursor-pointer">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={picked.has(c.name)} onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(c.name) : n.delete(c.name); return n })} />
                <span className="font-mono text-zinc-200">/{c.name}</span>
                <span className="text-[10px] text-zinc-500">{c.files} files · {kb(c.bytes)}</span>
                {c.exists && <span className="text-[10px] text-amber-400">already installed</span>}
                {c.hasScripts && <span className="text-[10px] text-red-400 inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />scripts</span>}
              </div>
              <div className="text-zinc-500 text-[11px] mt-1">{c.description}</div>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-zinc-400 bg-zinc-900 rounded p-2">{c.preview}</pre>
            </label>
          ))}
          <div className="text-[11px] text-zinc-500">
            A skill steers the model and its files can be read by the agent. Install only what you trust. Scripts are copied, never run by the installer.
          </div>
          <div className="flex items-center gap-2">
            <select value={scope} onChange={(e) => setScope(e.target.value as 'user' | 'workspace')} className="bg-zinc-900 border border-zinc-700/80 rounded px-2 py-1 text-zinc-200 text-[11px]">
              <option value="user">For all projects (~/.claude/skills)</option>
              {hasWorkspace && <option value="workspace">This workspace only</option>}
            </select>
            <button type="button" disabled={busy || picked.size === 0} onClick={install} className={`${BTN} bg-amber-500/90 hover:bg-amber-400 border-amber-500 text-zinc-950 font-semibold`}>
              {busy ? 'Installing...' : `Install ${picked.size}`}
            </button>
            <button type="button" onClick={close} className={`${BTN} bg-zinc-900 border-zinc-700/80 text-zinc-300`}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div className={msg.ok ? 'text-emerald-400' : 'text-red-400'}>{msg.text}</div>}
    </div>
  )
}

/** "Add server": paste a .mcp.json snippet (or load one from a repo) -> masked preview with a warning -> save + connect. */
export const McpAdder: React.FC<{ onDone: (list: McpServerStatus[]) => void }> = ({ onDone }) => {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [prev, setPrev] = useState<McpPreview | null>(null)
  const [readme, setReadme] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const close = (): void => { setPrev(null); setReadme(null); setMsg(null); setOpen(false) }
  const loadRepo = async (): Promise<void> => {
    setBusy(true); setMsg(null); setReadme(null)
    try {
      const r = await window.aiDesktop!.mcp.inspectGithub(repo.trim())
      if (r.snippet) setText(r.snippet)
      else { setReadme(r.readme); setMsg({ ok: false, text: 'No .mcp.json in this repo. Copy the config snippet from the README below.' }) }
    } catch (e) { setMsg({ ok: false, text: msgOf(e) }) }
    setBusy(false)
  }
  const preview = async (): Promise<void> => {
    setBusy(true); setMsg(null)
    try { setPrev(await window.aiDesktop!.mcp.preview(text, name.trim() || undefined)) } catch (e) { setMsg({ ok: false, text: msgOf(e) }) }
    setBusy(false)
  }
  const add = async (): Promise<void> => {
    if (!prev) return
    setBusy(true)
    try {
      const list = await window.aiDesktop!.mcp.add(prev.token)
      onDone(list); setPrev(null); setText(''); setMsg({ ok: true, text: 'Saved. Connection status is shown on the cards above.' })
    } catch (e) { setMsg({ ok: false, text: msgOf(e) }); setPrev(null) }
    setBusy(false)
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${BTN} bg-zinc-900 hover:bg-zinc-800 border-zinc-700/80 text-zinc-300 inline-flex items-center gap-1`}>
        <Download className="w-3 h-3" /> Add server
      </button>
    )
  }
  return (
    <div className="p-3 bg-zinc-900/60 border border-zinc-700/60 rounded-lg space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 font-medium">Add MCP server</span>
        <button type="button" onClick={close} className="text-zinc-500 hover:text-zinc-300"><X className="w-3.5 h-3.5" /></button>
      </div>
      {!prev ? (
        <>
          <div className="flex gap-2">
            <input className={INPUT} placeholder="Optional: GitHub repo with a .mcp.json" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <button type="button" disabled={busy || !repo.trim()} onClick={loadRepo} className={`${BTN} bg-zinc-900 hover:bg-zinc-800 border-zinc-700/80 text-zinc-300 whitespace-nowrap`}>Load</button>
          </div>
          <textarea className={`${INPUT} h-28 resize-y`} placeholder={'{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "pkg"] } } }'} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2 items-center">
            <input className={`${INPUT} max-w-[10rem]`} placeholder="name (if single)" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" disabled={busy || !text.trim()} onClick={preview} className={`${BTN} bg-amber-500/90 hover:bg-amber-400 border-amber-500 text-zinc-950 font-semibold`}>Review</button>
          </div>
          {readme && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-zinc-400 bg-zinc-950 rounded p-2">{readme}</pre>}
        </>
      ) : (
        <div className="space-y-2">
          {prev.servers.map((s) => (
            <div key={s.name} className="p-2 bg-zinc-950 rounded border border-zinc-800 font-mono">
              <div className="text-zinc-200">{s.name} {s.replaces && <span className="text-[10px] text-amber-400">replaces existing</span>}</div>
              <div className="text-zinc-400 text-[11px] break-all">{s.command ? `${s.command} ${(s.args ?? []).join(' ')}` : `${s.type ?? 'http'} ${s.url}`}</div>
              {(s.env.length > 0 || s.headers.length > 0) && <div className="text-[10px] text-zinc-500">secrets kept hidden: {[...s.env, ...s.headers].join(', ')}</div>}
            </div>
          ))}
          <div className="flex items-start gap-1.5 text-[11px] text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Local servers run as a program on this computer with your user rights. Add only what you trust.</span>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={add} className={`${BTN} bg-amber-500/90 hover:bg-amber-400 border-amber-500 text-zinc-950 font-semibold`}>{busy ? 'Saving...' : 'Add and connect'}</button>
            <button type="button" onClick={() => setPrev(null)} className={`${BTN} bg-zinc-900 border-zinc-700/80 text-zinc-300`}>Back</button>
          </div>
        </div>
      )}
      {msg && <div className={msg.ok ? 'text-emerald-400' : 'text-red-400'}>{msg.text}</div>}
    </div>
  )
}
