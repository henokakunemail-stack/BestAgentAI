import React, { useState, useEffect } from 'react'
import { X, CheckSquare, Square, Plus, Trash2, Play, Pause } from 'lucide-react'
import { GoalItem } from '../../../../preload/index.d'

interface GoalsCardProps {
  isOpen: boolean
  onClose: () => void
  /** bumped when a goal changes during a run */
  refreshKey?: number
}

export const GoalsCard: React.FC<GoalsCardProps> = ({ isOpen, onClose, refreshKey }) => {
  const [goals, setGoals] = useState<GoalItem[]>([])
  const [newGoalText, setNewGoalText] = useState('')

  const loadGoals = async () => {
    const list = await window.aiDesktop?.goals?.getAll()
    if (list) setGoals(list)
  }

  useEffect(() => {
    if (isOpen) {
      loadGoals()
    }
  }, [isOpen, refreshKey])

  if (!isOpen) return null

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGoalText.trim()) return
    await window.aiDesktop?.goals?.add(newGoalText.trim())
    setNewGoalText('')
    loadGoals()
  }

  const handleToggle = async (id: string) => {
    await window.aiDesktop?.goals?.toggle(id)
    loadGoals()
  }

  const handleDelete = async (id: string) => {
    await window.aiDesktop?.goals?.delete(id)
    loadGoals()
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-zinc-950 border-l border-zinc-800 p-4 shadow-2xl flex flex-col z-40 select-none">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <CheckSquare className="w-4 h-4 text-amber-500" />
          <span>Codex Active Goals</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleAddGoal} className="my-3 flex gap-2">
        <input
          type="text"
          value={newGoalText}
          onChange={(e) => setNewGoalText(e.target.value)}
          placeholder="New milestone / goal..."
          className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          className="p-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </form>

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {goals.length === 0 ? (
          <div className="text-xs text-zinc-400 italic p-3 text-center">No active goals tracked</div>
        ) : (
          goals.map((goal) => (
            <div
              key={goal.id}
              className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800/80 text-xs text-zinc-200"
            >
              <div
                onClick={() => handleToggle(goal.id)}
                className="flex items-center gap-2 cursor-pointer flex-1 truncate mr-2"
              >
                {goal.completed ? (
                  <CheckSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                )}
                <span className={`truncate ${goal.completed ? 'line-through text-zinc-500' : ''}`}>
                  {goal.text}
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 mr-1 whitespace-nowrap">
                {goal.status} {Math.round((goal.tokensUsed / goal.tokenBudget) * 100)}%
              </span>
              {goal.status !== 'complete' && (
                <button
                  onClick={async () => {
                    await window.aiDesktop?.goals?.setStatus(goal.id, goal.status === 'active' ? 'paused' : 'active')
                    loadGoals()
                  }}
                  title={goal.status === 'active' ? 'Pause' : 'Activate (auto-continues after each reply)'}
                  className="p-1 hover:text-amber-400 text-zinc-500 transition-colors"
                >
                  {goal.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
              )}
              <button
                onClick={() => handleDelete(goal.id)}
                className="p-1 hover:text-red-400 text-zinc-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
