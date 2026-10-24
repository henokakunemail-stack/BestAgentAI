import React, { useState, useEffect } from 'react'
import { X, Database, Plus, Trash2 } from 'lucide-react'
import { MemoryItem } from '../../../../preload/index.d'

interface MemoryDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export const MemoryDrawer: React.FC<MemoryDrawerProps> = ({ isOpen, onClose }) => {
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [keyInput, setKeyInput] = useState('')
  const [valInput, setValInput] = useState('')

  const loadMemories = async () => {
    const list = await window.aiDesktop?.memory?.getAll()
    if (list) setMemories(list)
  }

  useEffect(() => {
    if (isOpen) {
      loadMemories()
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyInput.trim() || !valInput.trim()) return
    await window.aiDesktop?.memory?.add(keyInput.trim(), valInput.trim())
    setKeyInput('')
    setValInput('')
    loadMemories()
  }

  const handleDelete = async (id: string) => {
    await window.aiDesktop?.memory?.delete(id)
    loadMemories()
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-zinc-950 border-l border-zinc-800 p-4 shadow-2xl flex flex-col z-40 select-none">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Database className="w-4 h-4 text-blue-400" />
          <span>Codex Long-Term Memory</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleAdd} className="my-3 space-y-2">
        <input
          type="text"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="Topic / Key (e.g. preferred-stack)..."
          className="w-full bg-zinc-900 border border-zinc-700/80 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={valInput}
            onChange={(e) => setValInput(e.target.value)}
            placeholder="Value / rule..."
            className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <button
            type="submit"
            className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {memories.length === 0 ? (
          <div className="text-xs text-zinc-400 italic p-3 text-center">No memories stored in SQLite</div>
        ) : (
          memories.map((mem) => (
            <div
              key={mem.id}
              className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800/80 text-xs text-zinc-200"
            >
              <div className="flex items-center justify-between font-mono text-[11px] text-blue-400 font-semibold mb-1">
                <span>{mem.key}</span>
                <button
                  onClick={() => handleDelete(mem.id)}
                  className="p-0.5 hover:text-red-400 text-zinc-500 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="text-[11px] text-zinc-300 leading-relaxed break-words">{mem.value}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
