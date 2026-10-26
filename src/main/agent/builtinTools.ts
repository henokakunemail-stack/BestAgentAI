// Built-in (non-MCP) tools: apply_patch (Codex), update_plan (Codex / Antigravity task.md).
import Anthropic from '@anthropic-ai/sdk'
import { applyPatch } from './applyPatch'
import { skillsLoader } from './skillsLoader'
import { readFileTool, writeFileTool, editFileTool, globTool, grepTool, bashTool, webFetchTool } from './fileTools'
import { startJob, readJob, writeJob, killJob } from './bgJobs'
import { updateGoal } from '../storage/goalsStore'
import { addMemory } from '../storage/memoryStore'
import { isWriteLike } from '../mcp/permissionPolicy'

export const BUILTIN_SERVER = 'builtin'

const obj = (properties: Record<string, unknown>, required: string[] = []): Anthropic.Tool['input_schema'] =>
  ({ type: 'object', properties, required }) as Anthropic.Tool['input_schema']
const str = { type: 'string' }
const int = { type: 'integer' }

export const BUILTIN_TOOLS: Anthropic.Tool[] = [
  {
    name: `${BUILTIN_SERVER}__read_file`,
    description: 'Read a text file (or list a directory) with line numbers. Use offset/limit for large files. Must be called before edit_file/write_file on an existing file. Paths outside the workspace root need the user\'s approval.',
    input_schema: obj({ path: str, offset: int, limit: int }, ['path'])
  },
  {
    name: `${BUILTIN_SERVER}__write_file`,
    description: 'Create or fully overwrite a file inside the workspace. Existing files must be read first. Prefer edit_file for changes.',
    input_schema: obj({ path: str, content: str }, ['path', 'content'])
  },
  {
    name: `${BUILTIN_SERVER}__edit_file`,
    description: 'Exact string replacement in a file already read. old_string must be unique unless replace_all is true.',
    input_schema: obj({ path: str, old_string: str, new_string: str, replace_all: { type: 'boolean' } }, ['path', 'old_string', 'new_string'])
  },
  {
    name: `${BUILTIN_SERVER}__glob`,
    description: 'Find files by glob pattern (e.g. "src/**/*.ts"), newest first. Skips node_modules and .git.',
    input_schema: obj({ pattern: str, path: str }, ['pattern'])
  },
  {
    name: `${BUILTIN_SERVER}__grep`,
    description: 'Regex search file contents. Returns path:line:text. Filter files with glob; set ignore_case; cap with head_limit.',
    input_schema: obj({ pattern: str, path: str, glob: str, ignore_case: { type: 'boolean' }, head_limit: int }, ['pattern'])
  },
  {
    name: `${BUILTIN_SERVER}__bash`,
    description:
      'Run a shell command in the workspace root (cmd.exe on Windows, sh elsewhere). Default timeout 120s, max 600s. Returns output and exit code. Set run_in_background=true for dev servers, watchers and other long-running processes: it returns a job id immediately; read it with bash_output, stop it with bash_kill. Background jobs are killed when this run ends.',
    input_schema: obj({ command: str, timeout_ms: int, run_in_background: { type: 'boolean' } }, ['command'])
  },
  {
    name: `${BUILTIN_SERVER}__bash_output`,
    description: 'Read output of a background job. Pass the "next" value from the previous call as since to get only new output. Also reports whether the job is still running.',
    input_schema: obj({ id: str, since: int }, ['id'])
  },
  {
    name: `${BUILTIN_SERVER}__bash_input`,
    description: 'Write text to the stdin of a background job (add "\\n" to submit a line).',
    input_schema: obj({ id: str, text: str }, ['id', 'text'])
  },
  {
    name: `${BUILTIN_SERVER}__bash_kill`,
    description: 'Kill a background job and its child processes.',
    input_schema: obj({ id: str }, ['id'])
  },
  {
    name: `${BUILTIN_SERVER}__request_user_input`,
    description:
      'Ask the user a clarifying question and wait for the answer. Use it when a decision is theirs to make or the request is ambiguous, instead of guessing. Give "options" (2-4 short choices) when the answer is a pick; the user can always type something else. Not available to subagents.',
    input_schema: obj({ question: str, options: { type: 'array', items: str } }, ['question'])
  },
  {
    name: `${BUILTIN_SERVER}__web_fetch`,
    description: 'Fetch a public http(s) URL and return its text (HTML is stripped to plain text). Needs the user\'s approval per host; localhost and private network addresses are refused.',
    input_schema: obj({ url: str }, ['url'])
  },
  {
    name: `${BUILTIN_SERVER}__skill`,
    description: 'Load the full instructions of a skill listed under [Available skills]. Call it before starting work the skill covers.',
    input_schema: obj({ name: str }, ['name'])
  },
  {
    name: `${BUILTIN_SERVER}__apply_patch`,
    description:
      'Edit files with a context-anchored patch. Format: "*** Begin Patch", then hunks ("*** Add File: p" with + lines, "*** Update File: p" with optional "*** Move to: p" and "@@ <context header>" chunks of " ", "-", "+" lines, "*** Delete File: p"), then "*** End Patch". No line numbers. Paths relative to workspace root.',
    input_schema: { type: 'object', properties: { patch: { type: 'string' } }, required: ['patch'] }
  },
  {
    name: `${BUILTIN_SERVER}__update_plan`,
    description:
      'Publish/refresh the visible step checklist. Keep exactly one step in_progress. Mark steps completed only after verifying them.',
    input_schema: {
      type: 'object',
      properties: {
        explanation: { type: 'string' },
        plan: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
            },
            required: ['step', 'status']
          }
        }
      },
      required: ['plan']
    }
  },
  {
    name: `${BUILTIN_SERVER}__remember`,
    description: 'Save a durable fact (user preference, project convention) to long-term memory. Never store secrets.',
    input_schema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] }
  },
  {
    name: `${BUILTIN_SERVER}__update_goal`,
    description:
      'Report the status of the active goal. Use status "complete" only after verifying the objective is met; "blocked" if you need the user.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['complete', 'blocked'] }, note: { type: 'string' } },
      required: ['status']
    }
  }
]

/** Offered only while permissionMode is 'plan'. Approval is handled by PermissionGate; the switch by AgentRunner. */
export const EXIT_PLAN_TOOL: Anthropic.Tool = {
  name: `${BUILTIN_SERVER}__exit_plan_mode`,
  description:
    'Plan mode only. Present your finished implementation plan (markdown) to the user for approval. If approved, plan mode ends and you may edit files and run commands. Do not call it until you have explored enough to plan concretely.',
  input_schema: obj({ plan: str }, ['plan'])
}

/** `catalog` = agentCatalog(...) text so the model knows which agent_type values exist. */
export const buildSpawnTool = (catalog = ''): Anthropic.Tool => ({
  name: `${BUILTIN_SERVER}__spawn_agent`,
  description:
    'Delegate a self-contained task to a subagent with its own fresh context. It returns only its final report, so the task must include everything it needs. Several spawn_agent calls in one turn run in parallel. Set isolate=true to work in a separate git worktree (requires a git repo). Set agent_type to use a predefined agent (its own instructions, model and tool whitelist).' +
    (catalog ? `\n${catalog}` : ''),
  input_schema: obj({ task: str, isolate: { type: 'boolean' }, agent_type: str }, ['task'])
})

export async function runBuiltin(
  name: string,
  args: any,
  ctx: { workspaceRoot: string; emit: (e: any) => void; goalId?: string; signal?: AbortSignal; runId?: string; trusted?: boolean }
): Promise<string> {
  if (name === 'skill') {
    const s = await skillsLoader.getSkill(String(args?.name ?? ''), ctx.trusted ? ctx.workspaceRoot : undefined)
    if (!s) throw new Error(`Unknown skill: ${args?.name}`)
    return s.content
  }
  if (name === 'read_file') return readFileTool(ctx.workspaceRoot, args ?? {}, ctx.runId)
  if (name === 'write_file') return writeFileTool(ctx.workspaceRoot, args ?? {}, ctx.runId)
  if (name === 'edit_file') return editFileTool(ctx.workspaceRoot, args ?? {}, ctx.runId)
  if (name === 'glob') return globTool(ctx.workspaceRoot, args ?? {})
  if (name === 'grep') return grepTool(ctx.workspaceRoot, args ?? {})
  // jobs are owned by the run (runId) so they die with it
  const owner = ctx.runId ?? 'adhoc'
  if (name === 'bash' && args?.run_in_background) {
    const command = String(args.command ?? '').trim()
    if (!command) throw new Error('"command" is required')
    return `Started background job ${startJob(owner, ctx.workspaceRoot, command)}. Use bash_output to read it and bash_kill to stop it.`
  }
  if (name === 'bash') return bashTool(ctx.workspaceRoot, args ?? {}, ctx.signal)
  if (name === 'bash_output') return readJob(owner, args?.id, args?.since === undefined ? undefined : Number(args.since))
  if (name === 'bash_input') return writeJob(owner, args?.id, String(args?.text ?? ''))
  if (name === 'bash_kill') return killJob(owner, args?.id)
  if (name === 'web_fetch') return webFetchTool(args ?? {}, ctx.signal)
  if (name === 'apply_patch') return applyPatch(String(args?.patch ?? ''), ctx.workspaceRoot)
  if (name === 'update_plan') {
    ctx.emit({ type: 'plan_update', plan: args?.plan ?? [], explanation: args?.explanation })
    return 'Plan updated.'
  }
  if (name === 'remember') {
    await addMemory(String(args?.key ?? '').slice(0, 60), String(args?.value ?? '').slice(0, 300))
    return 'Saved to memory.'
  }
  if (name === 'update_goal') {
    if (!ctx.goalId) throw new Error('No active goal for this run')
    await updateGoal(ctx.goalId, { status: args?.status === 'complete' ? 'complete' : 'blocked', note: args?.note })
    ctx.emit({ type: 'goal_update', goalId: ctx.goalId, status: args?.status })
    return `Goal marked ${args?.status}.`
  }
  throw new Error(`Unknown builtin tool: ${name}`)
}

/** Runs alone (not in a parallel batch). Single source of truth lives in permissionPolicy. */
// spawn_agent without isolate edits the shared workspace, so it runs alone; isolated ones get their own worktree and may run together.
export const isWriteTool = (n: string, input?: any) => isWriteLike(n) || /apply_patch/i.test(n) || (/spawn_agent$/.test(n) && !input?.isolate)
