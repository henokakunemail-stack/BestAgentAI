import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync } from 'node:fs'

export interface ReaStatus {
  initialized: boolean
  jdkPath: string
  jarFound: boolean
  toolsCount: number
  error?: string
}

const DEFAULT_REA_SCRIPT = 'C:\\Users\\henok\\AppData\\Roaming\\npm\\node_modules\\rea-agents\\scripts\\rea.mjs'
const DEFAULT_JDK_BIN = 'C:\\Program Files\\Microsoft\\jdk-21.0.12.101-hotspot\\bin'
const DEFAULT_JADX_JAR = 'C:\\tools\\jadx-headless-mcp-0.7.1-all.jar'

// Deferred loading (Claude Code ToolSearch pattern): REA has ~207 tools / 3 MB of schemas.
// Only two router tools go to the model; it searches by keyword, then calls by exact name.
export const REA_ROUTER_TOOLS = [
  {
    name: 'rea_search_tools',
    description: '[MCP REA] Search REA reverse-engineering tools by keyword. Returns name, description and input schema of the best matches. Call this before rea_call_tool.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keywords, e.g. "electron asar", "apk manifest", "decompile"' } },
      required: ['query']
    }
  },
  {
    name: 'rea_call_tool',
    description: '[MCP REA] Call an exact REA tool found via rea_search_tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact REA tool name' },
        arguments: { type: 'object', description: 'Arguments matching that tool input schema' }
      },
      required: ['name']
    }
  }
]

export class ReaClient {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private initialized = false
  private error?: string

  async getStatus(): Promise<ReaStatus> {
    return {
      initialized: this.initialized,
      jdkPath: DEFAULT_JDK_BIN,
      jarFound: existsSync(DEFAULT_JADX_JAR),
      toolsCount: REA_ROUTER_TOOLS.length,
      error: this.error
    }
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true

    const scriptExists = existsSync(DEFAULT_REA_SCRIPT)
    if (!scriptExists) {
      this.error = `REA script not found at ${DEFAULT_REA_SCRIPT}`
      return false
    }

    try {
      const childPath = `${DEFAULT_JDK_BIN};C:\\tools;C:\\Program Files\\nodejs;C:\\Windows\\system32;C:\\Windows;${process.env.PATH || ''}`

      this.client = new Client({ name: 'ai-desktop-rea', version: '1.0.0' }, { capabilities: {} })
      this.transport = new StdioClientTransport({
        command: 'node',
        args: [DEFAULT_REA_SCRIPT, '--mcp'],
        env: {
          ...process.env,
          PATH: childPath,
          REA_JADX_MCP_JAR: DEFAULT_JADX_JAR
        }
      })

      // Generous timeout for 3.4MB bundle and JADX warmup
      const connectPromise = this.client.connect(this.transport)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('REA MCP timeout after 90000ms')), 90000)
      )

      await Promise.race([connectPromise, timeoutPromise])
      this.initialized = true
      this.error = undefined
      return true
    } catch (err: any) {
      this.error = err.message
      this.initialized = false
      return false
    }
  }

  getRouterTools() {
    return REA_ROUTER_TOOLS.map((t) => ({
      ...t,
      serverName: 'rea'
    }))
  }

  async executeTool(toolName: string, args: any, signal?: AbortSignal): Promise<any> {
    if (!this.initialized) await this.initialize()
    if (!this.client || !this.initialized) throw new Error(`REA not connected: ${this.error ?? 'unknown error'}`)
    if (toolName === 'rea_search_tools') {
      const terms = String(args?.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const scored = (await this.listAllTools())
        .map((t) => {
          const hay = `${t.name} ${t.description ?? ''}`.toLowerCase()
          return { t, score: terms.filter((w) => hay.includes(w)).length }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ t }) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
      return { content: scored }
    }
    if (toolName === 'rea_call_tool') {
      if (!args?.name) throw new Error('rea_call_tool requires "name"')
      return await this.client.callTool({ name: args.name, arguments: args.arguments ?? {} }, undefined, {
        timeout: 300_000,
        resetTimeoutOnProgress: true,
        signal
      })
    }
    throw new Error(`Unknown REA router tool: ${toolName}`)
  }

  /** Raw tool list from REA (207 tools); used for on-demand lookup, never sent upfront. */
  async listAllTools(): Promise<any[]> {
    if (!this.initialized) await this.initialize()
    if (!this.client) return []
    return (await this.client.listTools()).tools
  }
}

export const reaClient = new ReaClient()
