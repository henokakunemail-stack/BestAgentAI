import React from 'react'
import { Server, CheckCircle, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { McpServerStatus } from '../../../../preload/index.d'

export const McpServerCard: React.FC<{ server: McpServerStatus; onRemove?: (name: string) => void }> = ({ server, onRemove }) => {
  const isConnected = server.status === 'connected'
  const isConnecting = server.status === 'connecting'
  const isFailed = server.status === 'failed'
  const c = server.config
  const summary = c ? (c.command ? `${c.command} ${(c.args ?? []).join(' ')}` : `${c.type ?? 'http'} ${c.url ?? ''}`) : ''

  return (
    <div className="p-3 bg-zinc-900/70 border border-zinc-800 rounded-lg text-xs font-mono">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-semibold text-zinc-200">{server.name}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {isConnecting && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />}
          {isConnected && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
          {isFailed && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
          <span className="capitalize text-zinc-400 text-[11px]">{server.status}</span>
          {onRemove && (
            <button type="button" title="Remove server" onClick={() => onRemove(server.name)} className="ml-1 text-zinc-500 hover:text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {summary && <div className="mt-1 text-[10px] text-zinc-500 truncate" title={summary}>{summary}</div>}
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
        <span>Available tools: {server.toolsCount}</span>
        {server.error && <span className="text-red-400 truncate max-w-xs">{server.error}</span>}
      </div>
    </div>
  )
}
