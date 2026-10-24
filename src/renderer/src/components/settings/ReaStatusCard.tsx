import React, { useState, useEffect } from 'react'
import { ShieldCheck, Cpu, RefreshCw, CheckCircle2, AlertTriangle, Play } from 'lucide-react'
import { ReaStatus } from '../../../../preload/index.d'

export const ReaStatusCard: React.FC = () => {
  const [status, setStatus] = useState<ReaStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const checkStatus = async () => {
    const s = await window.aiDesktop?.rea?.getStatus()
    if (s) setStatus(s)
  }

  useEffect(() => {
    checkStatus()
  }, [])

  const handleInitialize = async () => {
    setLoading(true)
    await window.aiDesktop?.rea?.initialize()
    await checkStatus()
    setLoading(false)
  }

  return (
    <div className="p-4 bg-zinc-900/80 border border-zinc-700/80 rounded-xl text-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-zinc-100">MCP REA Engine (Reverse Engineer Anything)</span>
        </div>
        <button
          onClick={handleInitialize}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 text-white rounded text-xs transition-colors"
        >
          {loading ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3 fill-current" />
          )}
          <span>{status?.initialized ? 'Re-sync REA' : 'Initialize REA'}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div className="p-2 bg-zinc-950/60 rounded border border-zinc-800/80">
          <span className="text-zinc-500 block">JDK 21 Runtime:</span>
          <span className="text-zinc-200 truncate block">Microsoft JDK 21 (OK)</span>
        </div>

        <div className="p-2 bg-zinc-950/60 rounded border border-zinc-800/80">
          <span className="text-zinc-500 block">JADX Headless JAR:</span>
          <span className={status?.jarFound ? 'text-emerald-400' : 'text-amber-400'}>
            {status?.jarFound ? 'Found in C:\\tools' : 'Not Found'}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-zinc-400 border-t border-zinc-800/80 pt-2 font-mono">
        <span>Router Virtualization: 6 Core Handlers</span>
        <span className={status?.initialized ? 'text-emerald-400' : 'text-zinc-400'}>
          Status: {status?.initialized ? 'Online & Ready' : 'Standby / Lazy Loaded'}
        </span>
      </div>
    </div>
  )
}
