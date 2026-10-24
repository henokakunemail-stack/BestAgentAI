import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../main/ipc/channels'

export const api = {
  window: {
    minimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
    hideLauncher: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_HIDE_LAUNCHER),
    showMain: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_SHOW_MAIN),
    submitLauncher: (query: string) => ipcRenderer.send(IPC_CHANNELS.WINDOW_LAUNCHER_SUBMIT, query),
    onLauncherPrompt: (callback: (query: string) => void) => {
      const handler = (_: any, q: string) => callback(q)
      ipcRenderer.on(IPC_CHANNELS.WINDOW_LAUNCHER_PROMPT, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_LAUNCHER_PROMPT, handler)
    }
  },
  chat: {
    send: (params: { sessionId: string; prompt: string; attachments?: string[] }) =>
      ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND_MESSAGE, params),
    abort: (sessionId: string) => ipcRenderer.send(IPC_CHANNELS.CHAT_ABORT, sessionId),
    onStream: (callback: (event: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.CHAT_STREAM_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_STREAM_EVENT, handler)
    },
    getHistory: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_GET_HISTORY, sessionId),
    listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_LIST_SESSIONS),
    newSession: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_NEW_SESSION),
    deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_DELETE_SESSION, sessionId)
  },
  mcp: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_GET_STATUS),
    reloadConfig: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_RELOAD_CONFIG),
    preview: (text: string, name?: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_PREVIEW, { text, name }),
    add: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_ADD, token),
    remove: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_REMOVE, name),
    inspectGithub: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.MCP_INSPECT_GITHUB, url),
    confirmTool: (callId: string, approved: boolean, always = false) =>
      ipcRenderer.send(IPC_CHANNELS.TOOL_CONFIRM_DECISION, { callId, approved, always }),
    answerInput: (callId: string, answer: string) => ipcRenderer.send(IPC_CHANNELS.USER_INPUT_ANSWER, { callId, answer })
  },
  rea: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.REA_GET_STATUS),
    initialize: () => ipcRenderer.invoke(IPC_CHANNELS.REA_INITIALIZE),
    execute: (tool: string, args: any) => ipcRenderer.invoke(IPC_CHANNELS.REA_EXECUTE, { tool, args })
  },
  goals: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.GOALS_GET_ALL),
    add: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.GOALS_ADD, text),
    toggle: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.GOALS_TOGGLE, id),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.GOALS_DELETE, id),
    setStatus: (id: string, status: string) => ipcRenderer.invoke(IPC_CHANNELS.GOALS_SET_STATUS, { id, status })
  },
  memory: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.MEMORY_GET_ALL),
    add: (key: string, value: string) => ipcRenderer.invoke(IPC_CHANNELS.MEMORY_ADD, { key, value }),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MEMORY_DELETE, id)
  },
  terminal: {
    spawn: () => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_SPAWN),
    write: (data: string) => ipcRenderer.send(IPC_CHANNELS.TERMINAL_INPUT, data),
    onOutput: (callback: (data: string) => void) => {
      const handler = (_: any, data: string) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_OUTPUT, handler)
    }
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST),
    inspectGithub: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_INSPECT_GITHUB, url),
    install: (token: string, names: string[], scope: 'user' | 'workspace', overwrite: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.SKILLS_INSTALL, { token, names, scope, overwrite }),
    discard: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_DISCARD, token),
    remove: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_REMOVE, name)
  },
  commands: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.COMMANDS_LIST)
  },
  agents: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.AGENTS_LIST)
  },
  files: {
    complete: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.FILES_COMPLETE, query)
  },
  trust: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.TRUST_GET),
    set: (trusted: boolean) => ipcRenderer.invoke(IPC_CHANNELS.TRUST_SET, trusted)
  },
  hooks: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.HOOKS_GET),
    save: (cfg: any) => ipcRenderer.invoke(IPC_CHANNELS.HOOKS_SAVE, cfg)
  },
  providers: {
    test: (baseUrl: string, apiKey: string) => ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_TEST, baseUrl, apiKey),
    open: (target: 'claude' | 'openai' | 'router', baseUrl?: string) => ipcRenderer.invoke(IPC_CHANNELS.PROVIDERS_OPEN, target, baseUrl)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    save: (data: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, data)
  }
}

contextBridge.exposeInMainWorld('aiDesktop', api)
