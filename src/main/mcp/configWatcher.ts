import { app } from 'electron'
import { join } from 'node:path'
import { readJsonFile, updateJsonFile, writeFileAtomic } from '../storage/atomic'

import type { McpServerConfig } from './mcpConfig'
export type { McpServerConfig }

export interface DesktopConfig {
  anthropicApiKey?: string
  mcpServers?: Record<string, McpServerConfig>
}

export function getConfigPath(): string {
  return join(app.getPath('userData'), 'ai_desktop_config.json')
}

export async function readDesktopConfig(): Promise<DesktopConfig> {
  const configPath = getConfigPath()
  const { value, corrupt } = await readJsonFile<DesktopConfig>(configPath)
  if (value) return value
  // Unreadable file (and no usable .bak): never overwrite it with the sample, the user may want to repair it.
  if (corrupt) return { mcpServers: {} }
  // Missing file: sample config with the filesystem server
  const defaultConfig: DesktopConfig = {
    mcpServers: {
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()]
      }
    }
  }
  await writeFileAtomic(configPath, JSON.stringify(defaultConfig, null, 2), false).catch(() => {})
  return defaultConfig
}

/** Add or replace servers. Atomic, serialized with other writers. */
export function addServerConfigs(add: Record<string, McpServerConfig>): Promise<DesktopConfig> {
  return updateJsonFile<DesktopConfig>(getConfigPath(), {}, (cur) => ({ ...cur, mcpServers: { ...(cur.mcpServers ?? {}), ...add } }))
}

export function removeServerConfig(name: string): Promise<DesktopConfig> {
  return updateJsonFile<DesktopConfig>(getConfigPath(), {}, (cur) => {
    const { [name]: _gone, ...rest } = cur.mcpServers ?? {}
    return { ...cur, mcpServers: rest }
  })
}
