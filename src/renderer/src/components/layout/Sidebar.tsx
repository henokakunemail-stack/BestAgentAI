import React from 'react'
import { Plus, MessageSquare, Settings, CheckSquare, Database, Trash2, Cpu, Wrench } from 'lucide-react'
import { StoredSession } from '../../../../preload/index.d'

interface SidebarProps {
  sessions: StoredSession[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onDeleteSession: (id: string) => void
  onOpenSettings: () => void
  onOpenGoals: () => void
  onOpenMemory: () => void
  mcpConnectedCount: number
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onOpenSettings,
  onOpenGoals,
  onOpenMemory,
  mcpConnectedCount
}) => {
  return (
    <aside className="w-64 h-full bg-zinc-950 border-r border-zinc-800/80 flex flex-col justify-between select-none">
      <div className="p-3 flex flex-col flex-1 min-h-0">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-700/60 rounded-lg text-xs font-medium transition-all shadow-sm mb-3"
        >
          <Plus className="w-4 h-4 text-amber-500" />
          <span>New Chat</span>
        </button>

        <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider px-2 py-1">
          Recent Sessions
        </div>

        <div className="flex-1 overflow-y-auto space-y-0.5 pr-1 mt-1">
          {sessions.length === 0 ? (
            <div className="text-xs text-zinc-400 p-2 italic">No chats yet</div>
          ) : (
            sessions.map((s) => {
              const isActive = s.id === activeSessionId
              return (
                <div
                  key={s.id}
                  onClick={() => onSelectSession(s.id)}
                  className={`group flex items-center justify-between px-2.5 py-2 rounded-md text-xs cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-zinc-800/80 text-zinc-100 font-medium'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <MessageSquare className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                    <span className="truncate">{s.title || 'Untitled Chat'}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteSession(s.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
                    title="Delete session"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Footer Utilities (Codex Goals, Memory, MCP, Settings) */}
      <div className="p-3 border-t border-zinc-800/80 space-y-1 bg-zinc-950/50">
        <button
          onClick={onOpenGoals}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-md transition-colors"
        >
          <div className="flex items-center gap-2">
            <CheckSquare className="w-3.5 h-3.5 text-amber-500" />
            <span>Codex Goals</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">Tasks</span>
        </button>

        <button
          onClick={onOpenMemory}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-md transition-colors"
        >
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            <span>Memories</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">SQLite</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-md transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-3.5 h-3.5 text-zinc-400" />
            <span>Settings</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-mono">
            <Cpu className="w-3 h-3" />
            <span>{mcpConnectedCount} MCP</span>
          </div>
        </button>
      </div>
    </aside>
  )
}
