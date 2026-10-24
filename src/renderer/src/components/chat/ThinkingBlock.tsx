import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Brain } from 'lucide-react'

interface ThinkingBlockProps {
  thinking: string
  isStreaming?: boolean
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ thinking, isStreaming }) => {
  const [open, setOpen] = useState(false)
  if (!thinking) return null

  return (
    <div className="my-2 border border-zinc-800 rounded-lg bg-zinc-900/40 text-xs overflow-hidden transition-all">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <div className="flex items-center gap-2 font-mono">
          <Brain className={`w-3.5 h-3.5 ${isStreaming ? 'animate-pulse text-amber-400' : 'text-zinc-500'}`} />
          <span>Thought Process {isStreaming && '(thinking...)'}</span>
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 text-zinc-400 border-t border-zinc-800/60 whitespace-pre-wrap font-mono leading-relaxed text-[11px] max-h-60 overflow-y-auto bg-zinc-950/40">
          {thinking}
        </div>
      )}
    </div>
  )
}
