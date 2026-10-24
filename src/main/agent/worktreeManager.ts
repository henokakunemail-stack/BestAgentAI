import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

const execAsync = promisify(exec)

export class WorktreeManager {
  private baseDir: string

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir
  }

  async createWorktree(taskId: string): Promise<string> {
    const worktreePath = join(this.baseDir, '.worktrees', taskId)
    await fs.mkdir(join(this.baseDir, '.worktrees'), { recursive: true })

    // Real isolation only: a failure here must surface, not degrade to an empty folder.
    await execAsync(`git worktree add -b "agent/${taskId}" "${worktreePath}" HEAD`, { cwd: this.baseDir })
    return worktreePath
  }

  /** Removes the worktree and its branch when the subagent changed nothing (clean tree, HEAD still at `baseSha`). */
  async removeIfUnchanged(taskId: string, baseSha: string): Promise<boolean> {
    const worktreePath = join(this.baseDir, '.worktrees', taskId)
    try {
      const status = (await execAsync('git status --porcelain', { cwd: worktreePath })).stdout.trim()
      const head = (await execAsync('git rev-parse HEAD', { cwd: worktreePath })).stdout.trim()
      if (status || head !== baseSha) return false
      await execAsync(`git worktree remove "${worktreePath}"`, { cwd: this.baseDir })
      await execAsync(`git branch -D "agent/${taskId}"`, { cwd: this.baseDir })
      return true
    } catch {
      return false // keep it: better a leftover than lost work
    }
  }

  async removeWorktree(taskId: string): Promise<void> {
    const worktreePath = join(this.baseDir, '.worktrees', taskId)
    try {
      await execAsync(`git worktree remove --force "${worktreePath}"`, { cwd: this.baseDir })
    } catch {
      await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export const worktreeManager = new WorktreeManager()
