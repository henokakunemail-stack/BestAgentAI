// Pure MCP server config: stdio (command) or remote (url + type http|sse + headers). Kept electron-free for selfcheck.
export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  type?: 'stdio' | 'http' | 'sse'
  url?: string
  headers?: Record<string, string>
}

export type TransportSpec =
  | { kind: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
  | { kind: 'http' | 'sse'; url: URL; headers: Record<string, string> }

/** Throws a readable error for an unusable entry; a `url` entry defaults to streamable HTTP. */
export function transportSpec(conf: McpServerConfig): TransportSpec {
  const type = conf.type ?? (conf.url ? 'http' : 'stdio')
  if (type === 'stdio') {
    if (!conf.command) throw new Error('stdio server needs "command"')
    return { kind: 'stdio', command: conf.command, args: conf.args ?? [], env: conf.env }
  }
  if (type !== 'http' && type !== 'sse') throw new Error(`unknown type "${type}"`)
  let url: URL
  try { url = new URL(String(conf.url)) } catch { throw new Error(`${type} server needs a valid "url"`) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`url must be http(s): ${url.protocol}`)
  return { kind: type, url, headers: conf.headers ?? {} }
}
