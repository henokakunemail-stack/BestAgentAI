export interface ToolCallUI {
  callId: string
  toolName: string
  input: any
  status: 'pending_approval' | 'pending_input' | 'running' | 'success' | 'error'
  output?: string
  /** set on tool calls made by a subagent: the spawn_agent call they belong to */
  parentCallId?: string
  agentType?: string
  /** false: chained/substituting command, "always allow" would mint a rule broader than what was read */
  canAlways?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCallUI[]
}

export interface ArtifactData {
  identifier: string
  title: string
  type: 'html' | 'svg' | 'code' | 'markdown'
  content: string
}
