import React from 'react'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'

export interface PlanStep {
  step: string
  status: 'pending' | 'in_progress' | 'completed'
}

export const PlanCard: React.FC<{ plan: PlanStep[]; explanation?: string }> = ({ plan, explanation }) => {
  if (plan.length === 0) return null
  const done = plan.filter((p) => p.status === 'completed').length
  return (
    <div className="mx-4 mb-2 p-3 bg-zinc-900/70 border border-zinc-700/70 rounded-lg text-xs">
      <div className="flex items-center justify-between text-zinc-300 font-medium mb-1.5">
        <span>Plan</span>
        <span className="text-zinc-500">
          {done}/{plan.length}
        </span>
      </div>
      {explanation && <div className="text-zinc-500 mb-1.5">{explanation}</div>}
      <ul className="space-y-1">
        {plan.map((p, i) => (
          <li key={i} className="flex items-start gap-2">
            {p.status === 'completed' ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
            ) : p.status === 'in_progress' ? (
              <Loader2 className="w-3.5 h-3.5 mt-0.5 text-amber-400 animate-spin shrink-0" />
            ) : (
              <Circle className="w-3.5 h-3.5 mt-0.5 text-zinc-600 shrink-0" />
            )}
            <span className={p.status === 'completed' ? 'text-zinc-500 line-through' : 'text-zinc-200'}>{p.step}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
