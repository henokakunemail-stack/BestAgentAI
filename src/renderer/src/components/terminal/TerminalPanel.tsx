import React, { useState, useEffect, useRef } from 'react'
import { Terminal as TerminalIcon, X, Send, Trash2 } from 'lucide-react'

interface TerminalPanelProps {
  isOpen: boolean
  onClose: () => void
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ isOpen, onClose }) => {
  const [output, setOutput] = useState<string>('')
  const [inputCmd, setInputCmd] = useState<string>('')
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (isOpen) {
      window.aiDesktop?.terminal?.spawn()
      const unsubscribe = window.aiDesktop?.terminal?.onOutput((data) => {
        setOutput((prev) => prev + data)
      })
      return () => {
        if (unsubscribe) unsubscribe()
      }
    }
  }, [isOpen])

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [output])

  if (!isOpen) return null

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputCmd.trim()) return
    window.aiDesktop?.terminal?.write(`${inputCmd}\n`)
    setInputCmd('')
  }

  return (
    <div className="h-64 border-t border-zinc-800 bg-zinc-950 flex flex-col select-none z-30 font-mono text-xs">
      <div className="h-8 px-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
        <div className="flex items-center gap-2 text-zinc-300">
          <TerminalIcon className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-semibold text-[11px]">Claude Code Terminal (RTK Proxy Enabled)</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setOutput('')}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
            title="Clear"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <pre
        ref={preRef}
        className="flex-1 p-3 text-zinc-300 overflow-y-auto font-mono text-[11px] leading-relaxed select-text"
      >
        {output || 'Terminal session initialized.\n'}
      </pre>

      <form onSubmit={handleSend} className="p-2 border-t border-zinc-800 flex items-center gap-2 bg-zinc-900/40">
        <span className="text-amber-500 font-bold">$</span>
        <input
          type="text"
          value={inputCmd}
          onChange={(e) => setInputCmd(e.target.value)}
          placeholder="Run shell command..."
          className="flex-1 bg-transparent text-zinc-200 focus:outline-none text-[11px]"
        />
        <button
          type="submit"
          className="p-1 px-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-[11px]"
        >
          Send
        </button>
      </form>
    </div>
  )
}
