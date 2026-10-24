import React, { useState } from 'react'
import { X, Play, Code, RotateCcw, ExternalLink } from 'lucide-react'
import { ArtifactData } from '../../types/desktop'

interface ArtifactPanelProps {
  artifact: ArtifactData | null
  onClose: () => void
}

// Model-generated page: opaque origin (sandbox without allow-same-origin) and no fetch/XHR/WebSocket out.
const previewUrl = (html: string): string =>
  'data:text/html;charset=utf-8,' + encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="connect-src 'none'">` + html)

export const ArtifactPanel: React.FC<ArtifactPanelProps> = ({ artifact, onClose }) => {
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [key, setKey] = useState(0)

  if (!artifact) return null

  return (
    <div className="w-1/2 h-full border-l border-zinc-800 bg-zinc-950 flex flex-col select-none z-20">
      {/* Titlebar */}
      <div className="h-10 px-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
          <Code className="w-4 h-4 text-amber-500" />
          <span className="truncate max-w-[200px]">{artifact.title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono uppercase">
            {artifact.type}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex bg-zinc-800 p-0.5 rounded text-[11px] mr-2">
            <button
              onClick={() => setViewMode('preview')}
              className={`px-2 py-0.5 rounded transition-colors ${
                viewMode === 'preview' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setViewMode('code')}
              className={`px-2 py-0.5 rounded transition-colors ${
                viewMode === 'code' ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Code
            </button>
          </div>

          <button
            onClick={() => setKey((k) => k + 1)}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
            title="Reload Artifact"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
            title="Close Panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-3 bg-zinc-950">
        {viewMode === 'preview' ? (
          <iframe
            key={key}
            title={artifact.title}
            src={previewUrl(artifact.type === 'svg' ? `<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#09090b;">${artifact.content}</div>` : artifact.content)}
            sandbox="allow-scripts"
            className="w-full h-full bg-white rounded-lg border border-zinc-800 shadow-inner"
          />
        ) : (
          <pre className="w-full h-full p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 overflow-auto select-text">
            {artifact.content}
          </pre>
        )}
      </div>
    </div>
  )
}
