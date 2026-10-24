import { readJson, updateJson } from './db'

export interface MemoryItem {
  id: string
  key: string
  value: string
  createdAt: number
}

const FILE_NAME = 'memories.json'

export async function getMemories(): Promise<MemoryItem[]> {
  return await readJson<MemoryItem[]>(FILE_NAME, [])
}

export async function addMemory(key: string, value: string): Promise<MemoryItem> {
  let result!: MemoryItem
  await updateJson<MemoryItem[]>(FILE_NAME, [], (memories) => {
    const existing = memories.find((m) => m.key.toLowerCase() === key.toLowerCase())
    if (existing) {
      existing.value = value
      existing.createdAt = Date.now()
      result = existing
      return memories
    }
    result = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      key,
      value,
      createdAt: Date.now()
    }
    return [result, ...memories]
  })
  return result
}

export async function deleteMemory(id: string): Promise<boolean> {
  let removed = false
  await updateJson<MemoryItem[]>(FILE_NAME, [], (memories) => {
    const filtered = memories.filter((m) => m.id !== id)
    removed = filtered.length !== memories.length
    return filtered
  })
  return removed
}
