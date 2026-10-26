import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { readDesktopConfig, McpServerConfig } from './configWatcher'
import { transportSpec } from './mcpConfig'
import { stableJson, maskConfig } from '../install/githubSource'
import { isReadOnly } from './permissionPolicy'
import { backoffMs } from '../agent/retryPolicy'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'

export interface ServerInstance {
  client: Client
  transport: Transport
  tools: any[]
  status: 'connected' | 'connecting' | 'failed' | 'disconnected'
  error?: string
  config?: McpServerConfig
  /** reconnect attempts made so far for this outage (0 = never dropped) */
  retries: number
  timer?: NodeJS.Timeout
  /** set before WE close the transport, so onclose does not read as a crash */
  closing?: boolean
}

export const MAX_RECONNECTS = 8

export class McpClientManager {
  private servers: Map<string, ServerInstance> = new Map()
  private disposed = false

  async initialize(): Promise<void> {
    const config = await readDesktopConfig()
    await this.syncServers(config.mcpServers || {})
  }

  private async shutdown(inst: ServerInstance): Promise<void> {
    inst.closing = true
    clearTimeout(inst.timer)
    await inst.transport.close().catch(() => {})
  }

  async syncServers(serverConfigs: Record<string, McpServerConfig>): Promise<void> {
    // Terminate removed; drop failed ones too so a reload retries them (else a stale "failed" sticks forever)
    for (const [name, inst] of this.servers.entries()) {
      // also restart a server whose config was edited
      if (!serverConfigs[name] || inst.status === 'failed' || (inst.config && stableJson(inst.config) !== stableJson(serverConfigs[name]))) {
        await this.shutdown(inst)
        this.servers.delete(name)
      }
    }

    // Connect new servers in parallel, non-blocking per server (Claude Code MCP_SERVER_CONNECTION_BATCH_SIZE)
    await Promise.all(
      Object.entries(serverConfigs)
        .filter(([name]) => !this.servers.has(name))
        .map(([name, conf]) => this.connectOne(name, conf, 0))
    )
  }

  /** Stop reconnecting and close every server (app quit). */
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all([...this.servers.values()].map((s) => this.shutdown(s)))
  }

  /** One connection attempt. retries > 0 = a reconnect after a drop: a failure schedules the next attempt instead of giving up. */
  private async connectOne(name: string, conf: McpServerConfig, retries: number): Promise<void> {
    const CONNECT_TIMEOUT = Number(process.env.MCP_TIMEOUT) || 90_000
    const client = new Client({ name: 'ai-desktop', version: '1.0.0' }, { capabilities: {} })
    let transport: Transport
    try {
      const spec = transportSpec(conf)
      const requestInit = { headers: spec.kind === 'stdio' ? {} : spec.headers }
      transport =
        spec.kind === 'stdio'
          ? new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } })
          : spec.kind === 'http'
            ? new StreamableHTTPClientTransport(spec.url, { requestInit })
            : new SSEClientTransport(spec.url, { requestInit, eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...spec.headers } }) } })
    } catch (err: any) {
      this.servers.set(name, { client, transport: { close: async () => {} } as Transport, tools: [], status: 'failed', error: err.message, retries, config: conf })
      return
    }
    const instance: ServerInstance = { client, transport, tools: [], status: 'connecting', retries, config: conf }
    this.servers.set(name, instance)
    client.onclose = () => this.handleDown(name, instance)
    client.onerror = (e) => {
      instance.error = e.message // non-fatal protocol error: keep the status, remember the text
    }
    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT })
      await this.refreshTools(name, instance)
      if (client.getServerCapabilities()?.tools?.listChanged) {
        let debounce: NodeJS.Timeout | undefined
        client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
          clearTimeout(debounce)
          debounce = setTimeout(() => void this.refreshTools(name, instance).catch(() => {}), 300)
        })
      }
      instance.status = 'connected'
      instance.error = undefined
      instance.retries = 0
    } catch (err: any) {
      instance.status = 'failed'
      instance.error = err.message
      await this.shutdown(instance)
      if (retries > 0) this.scheduleReconnect(name, instance)
    }
  }

  private async refreshTools(name: string, inst: ServerInstance): Promise<void> {
    const { tools } = await inst.client.listTools(undefined, { timeout: Number(process.env.MCP_TIMEOUT) || 90_000 })
    inst.tools = tools.map((t) => ({ ...t, serverName: name }))
  }

  /** The transport closed without us asking (server crashed or exited): stop offering its tools and reconnect with backoff. */
  private handleDown(name: string, inst: ServerInstance): void {
    if (inst.closing || this.disposed || this.servers.get(name) !== inst || inst.status === 'failed') return
    inst.tools = []
    this.scheduleReconnect(name, inst)
  }

  private scheduleReconnect(name: string, inst: ServerInstance): void {
    if (this.disposed || this.servers.get(name) !== inst || !inst.config) return
    const n = inst.retries
    if (n >= MAX_RECONNECTS) {
      inst.status = 'failed'
      inst.error = `gave up after ${MAX_RECONNECTS} reconnect attempts (${inst.error ?? 'connection lost'})`
      return
    }
    inst.status = 'disconnected'
    inst.error = `reconnecting (${n + 1}/${MAX_RECONNECTS})`
    inst.timer = setTimeout(async () => {
      if (this.disposed || this.servers.get(name) !== inst) return
      await this.shutdown(inst)
      if (this.disposed || this.servers.get(name) !== inst) return
      await this.connectOne(name, inst.config!, n + 1)
    }, backoffMs(n))
  }

  private async waitConnected(name: string, ms: number, signal?: AbortSignal): Promise<ServerInstance | undefined> {
    const end = Date.now() + ms
    for (;;) {
      const inst = this.servers.get(name)
      if (inst?.status === 'connected') return inst
      if (!inst || inst.status === 'failed' || Date.now() >= end || signal?.aborted) return undefined
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  /**
   * MCP tool annotations (spec: readOnlyHint / destructiveHint) as one answer: true = declared read-only, false = declared
   * mutating or destructive, undefined = server said nothing (callers fall back to the name heuristic).
   * Hints are advisory and come from the server, so a `false` is trusted (asks more) while a `true` only skips the prompt a
   * read-only name would have skipped anyway.
   */
  readOnlyHint(serverName: string, toolName: string): boolean | undefined {
    const t = this.servers.get(serverName)?.tools.find((x) => x.name === toolName)
    const a = t?.annotations
    if (!a || typeof a !== 'object') return undefined
    if (a.destructiveHint === true) return false
    return typeof a.readOnlyHint === 'boolean' ? a.readOnlyHint : undefined
  }

  getAllTools(): Array<{ name: string; description?: string; inputSchema?: any; serverName: string }> {
    const catalog: any[] = []
    for (const inst of this.servers.values()) {
      if (inst.status === 'connected') {
        catalog.push(...inst.tools)
      }
    }
    return catalog
  }

  async executeTool(serverName: string, toolName: string, args: Record<string, any>, signal?: AbortSignal): Promise<any> {
    const call = (inst: ServerInstance) =>
      // Per-call wall clock; progress notifications extend it (idle-watchdog behaviour)
      inst.client.callTool({ name: toolName, arguments: args }, undefined, {
        timeout: Number(process.env.MCP_TOOL_TIMEOUT) || 120_000,
        resetTimeoutOnProgress: true,
        signal
      })
    const readOnly = this.readOnlyHint(serverName, toolName) ?? isReadOnly(toolName)
    let inst = this.servers.get(serverName)
    // Mid-reconnect: a read-only call may wait briefly for the server; a write fails now (no duplicated side effects).
    if (inst?.status === 'disconnected' && readOnly) inst = await this.waitConnected(serverName, 3_000, signal)
    if (!inst || inst.status !== 'connected') {
      throw new Error(`MCP Server [${serverName}] is not connected${inst?.error ? ` (${inst.error})` : ''}`)
    }
    try {
      return await call(inst)
    } catch (err: any) {
      // Connection died during the call. Retry once after the reconnect, read-only tools only.
      const lost = /connection closed|not connected/i.test(String(err?.message))
      if (!lost || signal?.aborted) throw err
      if (!readOnly) throw new Error(`MCP Server [${serverName}] connection was lost during ${toolName}; it may or may not have run. Check the result before retrying.`)
      const again = await this.waitConnected(serverName, 3_000, signal)
      if (!again) throw new Error(`MCP Server [${serverName}] connection lost and did not come back in time`)
      return await call(again)
    }
  }

  getStatus() {
    return Array.from(this.servers.entries()).map(([name, s]) => ({
      name,
      status: s.status,
      toolsCount: s.tools.length,
      error: s.error, // while disconnected this reads "reconnecting (n/8)"
      config: s.config ? maskConfig(s.config) : undefined // env/header values stay in main
    }))
  }
}

export const mcpManager = new McpClientManager()
