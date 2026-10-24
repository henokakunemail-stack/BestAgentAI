import React, { useState, useRef, useEffect } from 'react'
import { ArrowUp, Square, Sparkles, Shield } from 'lucide-react'
import { CommandItem } from '../../../../preload/index.d'

interface ChatInputProps {
  permissionMode?: string
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null } | null
  commands?: CommandItem[]
  onSendMessage: (text: string) => void
  isStreaming: boolean
  onAbort?: () => void
  modelName: string
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isStreaming,
  onAbort,
  modelName,
  permissionMode = 'default',
  usage = null,
  commands = []
}) => {
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
    }
  }, [text])

  // "/" autocomplete: only while typing the command word itself (no space yet)
  const query = /^\/([\w.-]*)$/.exec(text)?.[1]
  // "@" autocomplete: trailing @token attaches that workspace file when the message is sent
  const atQuery = /(?:^|\s)@([^\s"']*)$/.exec(text)?.[1]
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    if (atQuery === undefined) return setFiles([])
    let live = true
    window.aiDesktop?.files?.complete(atQuery).then((f) => live && setFiles(f ?? []))
    return () => { live = false }
  }, [atQuery])

  type Item = { key: string; label: string; desc: string; kind: string; apply: () => void }
  const items: Item[] = dismissed
    ? []
    : query !== undefined
      ? commands
          .filter((c) => c.name.toLowerCase().startsWith(query.toLowerCase()))
          .slice(0, 8)
          .map((c) => ({ key: c.name, label: `/${c.name}`, desc: c.description, kind: c.kind, apply: () => setText(`/${c.name} `) }))
      : atQuery !== undefined
        ? files.map((f) => ({
            key: f,
            label: `@${f}`,
            desc: '',
            kind: 'file',
            apply: () => setText(text.replace(/@[^\s"']*$/, f.includes(' ') ? `@"${f}" ` : `@${f} `))
          }))
        : []
  const open = items.length > 0
  const active = Math.min(sel, Math.max(items.length - 1, 0))
  const pick = (it: Item) => {
    it.apply()
    setSel(0)
  }

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!text.trim() || isStreaming) return
    onSendMessage(text.trim())
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSel((active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && text.trim() !== items[active].label)) {
        e.preventDefault()
        pick(items[active])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="p-4 bg-zinc-950/80 border-t border-zinc-800/80">
      <div className="max-w-4xl mx-auto">
        <div className="relative bg-zinc-900/90 border border-zinc-700/70 rounded-xl p-2.5 shadow-lg focus-within:border-amber-500/60 transition-colors">
          {open && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto z-10">
              {items.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault() // keep textarea focus
                    pick(c)
                  }}
                  onMouseEnter={() => setSel(i)}
                  className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-[11px] transition-colors ${
                    i === active ? 'bg-amber-500/10 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="font-mono text-amber-400 shrink-0">{c.label}</span>
                  <span className="truncate text-zinc-400 flex-1">{c.desc}</span>
                  <span className="text-[10px] text-zinc-500 shrink-0">{c.kind}</span>
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setSel(0)
              setDismissed(false)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Reply to AI Desktop... (e.g. /rea, /graphify, inspect binary, or ask code)"
            className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none max-h-44 font-sans leading-relaxed px-1"
          />

          <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 mt-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-zinc-300 font-mono flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                {modelName}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded border font-mono flex items-center gap-1 ${
                  permissionMode === 'bypass'
                    ? 'bg-red-500/10 border-red-500/40 text-red-300'
                    : permissionMode === 'plan'
                      ? 'bg-sky-500/10 border-sky-500/40 text-sky-300'
                      : 'bg-zinc-800 border-zinc-700/60 text-zinc-300'
                }`}
                title="Permission mode (change with /permissions)"
              >
                <Shield className="w-3 h-3" />
                {permissionMode}
              </span>
              {usage && usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0 && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700/60 text-zinc-400 font-mono"
                  title={`in ${usage.input} / out ${usage.output} / cache read ${usage.cacheRead} / cache write ${usage.cacheWrite}`}
                >
                  {((usage.input + usage.output + usage.cacheRead + usage.cacheWrite) / 1000).toFixed(1)}k tok
                  {usage.cost !== null && ` · $${usage.cost.toFixed(3)}`}
                </span>
              )}
              <span className="text-[10px] text-zinc-500 font-mono hidden lg:inline">Shift + Enter for new line</span>
            </div>

            <div className="flex items-center gap-2">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onAbort}
                  className="p-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-lg transition-colors flex items-center gap-1 text-[11px] px-2 font-medium"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSubmit()}
                  disabled={!text.trim()}
                  className={`p-1.5 rounded-lg transition-colors ${
                    text.trim()
                      ? 'bg-amber-600 hover:bg-amber-500 text-white'
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
