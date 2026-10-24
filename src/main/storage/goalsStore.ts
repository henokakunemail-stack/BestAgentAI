import { readJson, updateJson } from './db'

// Codex thread_goals: objective + status + token budget. `completed` kept for the old checklist UI.
export type GoalStatus = 'active' | 'paused' | 'blocked' | 'budget_limited' | 'complete'

export interface GoalItem {
  id: string
  text: string
  completed: boolean
  createdAt: number
  status: GoalStatus
  tokenBudget: number
  tokensUsed: number
  note?: string
}

const FILE_NAME = 'goals.json'
export const DEFAULT_GOAL_BUDGET = 400_000

const normalize = (g: Partial<GoalItem>): GoalItem => ({
  id: g.id!,
  text: g.text ?? '',
  createdAt: g.createdAt ?? Date.now(),
  status: g.status ?? (g.completed ? 'complete' : 'paused'),
  completed: g.status ? g.status === 'complete' : !!g.completed,
  tokenBudget: g.tokenBudget ?? DEFAULT_GOAL_BUDGET,
  tokensUsed: g.tokensUsed ?? 0,
  note: g.note
})

export async function getGoals(): Promise<GoalItem[]> {
  return (await readJson<Partial<GoalItem>[]>(FILE_NAME, [])).map(normalize)
}

export async function addGoal(text: string): Promise<GoalItem> {
  const newGoal = normalize({
    id: `goal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    text,
    status: 'paused'
  })
  await updateJson<Partial<GoalItem>[]>(FILE_NAME, [], (cur) => [newGoal, ...cur.map(normalize)])
  return newGoal
}

export async function updateGoal(id: string, patch: Partial<GoalItem>): Promise<GoalItem | null> {
  let found: GoalItem | null = null
  await updateJson<Partial<GoalItem>[]>(FILE_NAME, [], (cur) => {
    const goals = cur.map(normalize)
    const goal = goals.find((g) => g.id === id)
    if (goal) {
      Object.assign(goal, patch)
      goal.completed = goal.status === 'complete'
      found = goal
    }
    return goals
  })
  return found
}

export async function toggleGoal(id: string): Promise<boolean> {
  const goal = (await getGoals()).find((g) => g.id === id)
  if (!goal) return false
  await updateGoal(id, { status: goal.status === 'complete' ? 'paused' : 'complete' })
  return true
}

export async function deleteGoal(id: string): Promise<boolean> {
  let removed = false
  await updateJson<Partial<GoalItem>[]>(FILE_NAME, [], (cur) => {
    const filtered = cur.filter((g) => g.id !== id)
    removed = filtered.length !== cur.length
    return filtered
  })
  return removed
}
