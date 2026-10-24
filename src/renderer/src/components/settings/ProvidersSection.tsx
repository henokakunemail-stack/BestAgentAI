import React, { useState } from 'react'
import { Key, Plug, ExternalLink, AlertTriangle } from 'lucide-react'

export type Provider = 'anthropic' | '9router'

interface Props {
  provider: Provider
  setProvider: (p: Provider) => void
  apiKey: string
  setApiKey: (v: string) => void
  routerBaseUrl: string
  setRouterBaseUrl: (v: string) => void
  routerApiKey: string
  setRouterApiKey: (v: string) => void
  onModels: (ids: string[]) => void
}

const INPUT =
  'w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-zinc-100 placeholder-zinc-500 font-mono focus:outline-none focus:border-amber-500/60'
const BTN = 'flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-[11px] transition-colors'
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/

// ponytail: these only open a login page / dashboard. No OAuth and no token import here; accounts live in 9router.
export const ProvidersSection: React.FC<Props> = (p) => {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const open = async (target: 'claude' | 'openai' | 'router') => {
    const res = await window.aiDesktop?.providers?.open(target, p.routerBaseUrl)
    setMsg(res?.ok ? { ok: true, text: 'Opened in your browser.' } : { ok: false, text: res?.error ?? 'Failed to open.' })
  }

  const test = async () => {
    setBusy(true)
    const res = await window.aiDesktop?.providers?.test(p.routerBaseUrl, p.routerApiKey)
    setBusy(false)
    if (!res) return setMsg({ ok: false, text: 'Bridge unavailable.' })
    if ('error' in res) return setMsg({ ok: false, text: res.error })
    p.onModels(res.models)
    setMsg({ ok: true, text: `Connected. ${res.models.length} models available.` })
  }

  // 9router login = log in inside its dashboard; the app switches to gateway mode and opens it.
  const viaRouter = (target: 'router') => {
    p.setProvider('9router')
    void open(target)
  }

  const nonLocal = (() => {
    try {
      const u = new URL(p.routerBaseUrl)
      return u.protocol === 'http:' && !LOOPBACK.test(u.hostname)
    } catch {
      return false
    }
  })()

  const active = (on: boolean) => (on ? 'bg-amber-600/20 border-amber-500/60 text-amber-300' : 'bg-zinc-900 border-zinc-700/80 text-zinc-300 hover:bg-zinc-800')

  return (
    <div className="space-y-2">
      <label className="text-zinc-300 font-medium flex items-center gap-1.5">
        <Plug className="w-3.5 h-3.5 text-amber-500" />
        <span>Providers</span>
      </label>
      <div className="grid grid-cols-4 gap-2">
        <button type="button" data-testid="prov-claude" className={`${BTN} ${active(p.provider === 'anthropic')}`}
          onClick={() => { p.setProvider('anthropic'); void open('claude') }}>
          Claude <ExternalLink className="w-3 h-3" />
        </button>
        <button type="button" data-testid="prov-chatgpt" className={`${BTN} ${active(false)}`} onClick={() => viaRouter('router')}>
          ChatGPT <ExternalLink className="w-3 h-3" />
        </button>
        <button type="button" data-testid="prov-antigravity" className={`${BTN} ${active(false)}`} onClick={() => viaRouter('router')}>
          Antigravity <ExternalLink className="w-3 h-3" />
        </button>
        <button type="button" data-testid="prov-9router" className={`${BTN} ${active(p.provider === '9router')}`} onClick={() => p.setProvider('9router')}>
          9router
        </button>
      </div>

      {p.provider === 'anthropic' ? (
        <div className="space-y-1.5">
          <label className="text-zinc-400 flex items-center gap-1.5">
            <Key className="w-3 h-3 text-amber-500" />
            Anthropic API Key
          </label>
          <input type="password" value={p.apiKey} onChange={(e) => p.setApiKey(e.target.value)} placeholder="sk-ant-..." className={INPUT} />
          <div className="text-zinc-500 text-[11px]">
            Claude button opens the Anthropic console to create a key. Claude subscription login is not supported directly; use 9router for that.
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-zinc-500 text-[11px]">
            ChatGPT and Antigravity open the 9router dashboard: log in to each account there, then paste a 9router API key below. This app never stores those logins.
          </div>
          <input value={p.routerBaseUrl} onChange={(e) => p.setRouterBaseUrl(e.target.value)} placeholder="http://localhost:20128" className={INPUT} />
          <input type="password" value={p.routerApiKey} onChange={(e) => p.setRouterApiKey(e.target.value)} placeholder="9router API key (dashboard > Keys)" className={INPUT} />
          {nonLocal && (
            <div className="flex items-start gap-1.5 text-amber-400 text-[11px]">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>Non-local http URL: your key travels unencrypted. Use localhost or https.</span>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" data-testid="prov-test" onClick={test} disabled={busy}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-[11px] text-zinc-300 disabled:opacity-50">
              {busy ? 'Testing...' : 'Test connection'}
            </button>
            <button type="button" data-testid="prov-dashboard" onClick={() => open('router')}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded text-[11px] text-zinc-300">
              Open dashboard
            </button>
          </div>
          <div className="text-zinc-500 text-[11px]">
            Non-Claude models may not support thinking, prompt caching or every tool. Thinking is turned off in this mode.
          </div>
        </div>
      )}
      {msg && <div data-testid="prov-msg" className={`text-[11px] ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</div>}
    </div>
  )
}
