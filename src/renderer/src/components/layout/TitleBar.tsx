import React from 'react'
import { Minus, Square, X, Bot, Sparkles, Terminal } from 'lucide-react'

interface TitleBarProps {
  onToggleTerminal?: () => void
}

export const TitleBar: React.FC<TitleBarProps> = ({ onToggleTerminal }) => {
  return (
    <header className="h-10 w-full bg-zinc-950 flex items-center justify-between px-3 border-b border-zinc-800 text-zinc-400 app-region-drag select-none z-50">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
        <div className="p-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <Bot className="w-3.5 h-3.5" />
        </div>
        <span className="font-semibold tracking-wide">AI Desktop</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono">
          Opus 5.5
        </span>
      </div>

      <div className="flex items-center gap-1 app-region-no-drag">
        {onToggleTerminal && (
          <button
            onClick={onToggleTerminal}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors mr-2"
            title="Toggle Claude Code Terminal"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="text-[11px]">Terminal</span>
          </button>
        )}

        <button
          onClick={() => window.aiDesktop?.window?.minimize()}
          className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => window.aiDesktop?.window?.maximize()}
          className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
          title="Maximize"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => window.aiDesktop?.window?.close()}
          className="p-1.5 hover:bg-red-600 hover:text-white rounded transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  )
}
