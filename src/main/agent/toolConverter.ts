import Anthropic from '@anthropic-ai/sdk'

export function convertMcpToAnthropicTool(mcpTool: any): Anthropic.Tool {
  const serverName = mcpTool.serverName || 'mcp'
  const toolName = mcpTool.name

  return {
    name: `${serverName}__${toolName}`,
    description: `[Server: ${serverName}] ${mcpTool.description || ''}`,
    input_schema: {
      type: 'object',
      properties: mcpTool.inputSchema?.properties || {},
      required: mcpTool.inputSchema?.required || []
    }
  }
}

export function parseToolName(namespacedName: string): { serverName: string; originalName: string } {
  const parts = namespacedName.split('__')
  if (parts.length > 1) {
    return {
      serverName: parts[0],
      originalName: parts.slice(1).join('__')
    }
  }
  return {
    serverName: 'mcp',
    originalName: namespacedName
  }
}
