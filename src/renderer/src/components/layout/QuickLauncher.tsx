import React, { useState, useEffect } from 'react'
import { Sparkles, ArrowRight, X, Bot } from 'lucide-react'

export const QuickLauncher: React.FC = () => {
  const [query, setQuery] = useState('')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.aiDesktop?.window?.hideLauncher()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    // Show main window and send query
    window.aiDesktop?.window?.submitLauncher(query.trim())
    window.aiDesktop?.window?.hideLauncher()
    setQuery('')
  }

  return (
    <div className="h-screen w-screen bg-zinc-950/95 border border-zinc-700/80 rounded-xl p-4 flex flex-col shadow-2xl backdrop-blur-md app-region-drag select-none">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <Bot className="w-4 h-4 text-amber-500" />
          <span>AI Desktop Quick Launcher</span>
        </div>
        <button
          onClick={() => window.aiDesktop?.window?.hideLauncher()}
          className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-300 app-region-no-drag"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex-1 flex flex-col justify-between app-region-no-drag">
        <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2.5">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask AI Desktop anything... (Enter to launch)"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none font-sans"
          />
          <button
            type="submit"
            className="p-1.5 bg-amber-600 hover:bg-amber-500 rounded text-white transition-colors"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono pt-4">
          <span>Ctrl + Space toggles launcher</span>
          <span>Esc to dismiss</span>
        </div>
      </form>
    </div>
  )
}
