export interface StreamEvent {
  type:
    | 'text' | 'thinking' | 'tool_call_start' | 'tool_call_result' | 'tool_permission_request' | 'user_input_request' | 'plan_update'
    | 'aborted' | 'done' | 'error' | 'goal_update' | 'session_reset' | 'settings_changed' | 'usage' | 'stream_reset' | 'retrying'
  sessionId?: string
  /** Set on events emitted by a subagent: the parent's spawn_agent callId and the agent type. */
  parentCallId?: string
  agentType?: string
  goalId?: string
  status?: string
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null }
  delta?: string
  callId?: string
  toolName?: string
  input?: any
  args?: any
  output?: string
  isError?: boolean
  error?: string
  plan?: Array<{ step: string; status: 'pending' | 'in_progress' | 'completed' }>
  explanation?: string
  question?: string
  options?: string[]
  /** tool_permission_request: false hides "always allow" (chained or substituting commands) */
  canAlways?: boolean
  /** stream_reset: chars of the failed attempt to cut from the end of the assistant message */
  dropText?: number
  dropThinking?: number
  /** retrying */
  attempt?: number
  delayMs?: number
  reason?: string
}

export interface StoredSession {
  id: string
  title: string
  updatedAt: number
}

export interface McpServerStatus {
  name: string
  status: 'connected' | 'connecting' | 'failed' | 'disconnected'
  toolsCount: number
  error?: string
  config?: { command?: string; args?: string[]; url?: string; type?: string; env: string[]; headers: string[] }
}

export interface McpPreview {
  token: string
  servers: Array<{ name: string; command?: string; args?: string[]; url?: string; type?: string; env: string[]; headers: string[]; replaces: boolean }>
}

export interface McpGithubInspect {
  url: string
  sha: string
  snippet: string | null
  readme: string | null
}

export interface SkillCandidate {
  name: string
  description: string
  relPath: string
  files: number
  bytes: number
  hasScripts: boolean
  exists: boolean
  preview: string
}

export interface SkillInspect {
  token: string
  url: string
  sha: string
  candidates: SkillCandidate[]
}

export interface ReaStatus {
  initialized: boolean
  jdkPath: string
  jarFound: boolean
  toolsCount: number
  error?: string
}

export interface GoalItem {
  id: string
  text: string
  completed: boolean
  createdAt: number
  status: 'active' | 'paused' | 'blocked' | 'budget_limited' | 'complete'
  tokenBudget: number
  tokensUsed: number
  note?: string
}

export interface MemoryItem {
  id: string
  key: string
  value: string
  createdAt: number
}

export interface SkillItem {
  name: string
  description: string
  trigger: string
}

export interface CommandItem {
  name: string
  description: string
  kind: 'builtin' | 'command' | 'skill'
}

export interface AgentItem {
  name: string
  description: string
  tools?: string[]
  model?: string
}

export interface HookDefItem {
  matcher?: string
  command: string
  timeoutMs?: number
}
export type HookConfigItem = Record<string, HookDefItem[]>

export interface AiDesktopApi {
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
    hideLauncher: () => void
    showMain: () => void
    submitLauncher: (query: string) => void
    onLauncherPrompt: (callback: (query: string) => void) => () => void
  }
  chat: {
    send: (params: { sessionId: string; prompt: string; attachments?: string[] }) => Promise<any>
    abort: (sessionId: string) => void
    onStream: (callback: (event: StreamEvent) => void) => () => void
    getHistory: (sessionId: string) => Promise<any>
    listSessions: () => Promise<StoredSession[]>
    newSession: () => Promise<string>
    deleteSession: (sessionId: string) => Promise<boolean>
  }
  mcp: {
    getStatus: () => Promise<McpServerStatus[]>
    reloadConfig: () => Promise<McpServerStatus[]>
    preview: (text: string, name?: string) => Promise<McpPreview>
    add: (token: string) => Promise<McpServerStatus[]>
    remove: (name: string) => Promise<McpServerStatus[]>
    inspectGithub: (url: string) => Promise<McpGithubInspect>
    confirmTool: (callId: string, approved: boolean, always?: boolean) => void
    answerInput: (callId: string, answer: string) => void
  }
  rea: {
    getStatus: () => Promise<ReaStatus>
    initialize: () => Promise<boolean>
    execute: (tool: string, args: any) => Promise<any>
  }
  goals: {
    getAll: () => Promise<GoalItem[]>
    add: (text: string) => Promise<GoalItem>
    toggle: (id: string) => Promise<boolean>
    delete: (id: string) => Promise<boolean>
    setStatus: (id: string, status: string) => Promise<GoalItem | null>
  }
  memory: {
    getAll: () => Promise<MemoryItem[]>
    add: (key: string, value: string) => Promise<MemoryItem>
    delete: (id: string) => Promise<boolean>
  }
  terminal: {
    spawn: () => Promise<void>
    write: (data: string) => void
    onOutput: (callback: (data: string) => void) => () => void
  }
  skills: {
    list: () => Promise<SkillItem[]>
    inspectGithub: (url: string) => Promise<SkillInspect>
    install: (token: string, names: string[], scope: 'user' | 'workspace', overwrite: boolean) => Promise<string[]>
    discard: (token: string) => Promise<void>
    remove: (name: string) => Promise<boolean>
  }
  commands: {
    list: () => Promise<CommandItem[]>
  }
  agents: {
    list: () => Promise<AgentItem[]>
  }
  files: {
    complete: (query: string) => Promise<string[]>
  }
  trust: {
    get: () => Promise<{ root: string; trusted: boolean }>
    set: (trusted: boolean) => Promise<{ root: string; trusted: boolean }>
  }
  hooks: {
    get: () => Promise<HookConfigItem>
    save: (cfg: HookConfigItem) => Promise<{ ok: true } | { ok: false; error: string }>
  }
  providers: {
    test: (baseUrl: string, apiKey: string) => Promise<{ ok: true; models: string[] } | { ok: false; error: string }>
    open: (target: 'claude' | 'openai' | 'router', baseUrl?: string) => Promise<{ ok: boolean; error?: string }>
  }
  settings: {
    get: () => Promise<any>
    save: (data: any) => Promise<void>
  }
}

declare global {
  interface Window {
    aiDesktop: AiDesktopApi
  }
}
