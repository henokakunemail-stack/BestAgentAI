// Codex queued_items: ordered per-session queue of messages sent while the agent is busy.
import { updateJson } from './db'

type Queues = Record<string, string[]>
const FILE = 'queue.json'

export async function enqueue(sessionId: string, prompt: string): Promise<number> {
  let n = 0
  await updateJson<Queues>(FILE, {}, (q) => {
    ;(q[sessionId] ??= []).push(prompt)
    n = q[sessionId].length
    return q
  })
  return n
}

export async function dequeue(sessionId: string): Promise<string | undefined> {
  let next: string | undefined
  await updateJson<Queues>(FILE, {}, (q) => {
    next = q[sessionId]?.shift()
    if (q[sessionId] && q[sessionId].length === 0) delete q[sessionId]
    return q
  })
  return next
}

export async function clearQueue(sessionId: string): Promise<void> {
  await updateJson<Queues>(FILE, {}, (q) => {
    delete q[sessionId]
    return q
  })
}
