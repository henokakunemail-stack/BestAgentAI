export const IPC_CHANNELS = {
  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_HIDE_LAUNCHER: 'window:hide-launcher',
  WINDOW_SHOW_MAIN: 'window:show-main',
  WINDOW_LAUNCHER_SUBMIT: 'window:launcher-submit',
  WINDOW_LAUNCHER_PROMPT: 'window:launcher-prompt',

  // Chat & Agent
  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_ABORT: 'chat:abort',
  CHAT_STREAM_EVENT: 'chat:stream-event',
  CHAT_GET_HISTORY: 'chat:get-history',
  CHAT_LIST_SESSIONS: 'chat:list-sessions',
  CHAT_NEW_SESSION: 'chat:new-session',
  CHAT_DELETE_SESSION: 'chat:delete-session',

  // MCP Standard & Tools
  MCP_GET_STATUS: 'mcp:get-status',
  MCP_RELOAD_CONFIG: 'mcp:reload-config',
  MCP_PREVIEW: 'mcp:preview',
  MCP_ADD: 'mcp:add',
  MCP_REMOVE: 'mcp:remove',
  MCP_INSPECT_GITHUB: 'mcp:inspect-github',
  TOOL_CONFIRM_DECISION: 'tool:confirm-decision',
  USER_INPUT_ANSWER: 'tool:user-input-answer',

  // MCP REA
  REA_GET_STATUS: 'rea:get-status',
  REA_INITIALIZE: 'rea:initialize',
  REA_EXECUTE: 'rea:execute',

  // Codex Goals & Memory
  GOALS_GET_ALL: 'goals:get-all',
  GOALS_ADD: 'goals:add',
  GOALS_TOGGLE: 'goals:toggle',
  GOALS_DELETE: 'goals:delete',
  GOALS_SET_STATUS: 'goals:set-status',
  MEMORY_GET_ALL: 'memory:get-all',
  MEMORY_ADD: 'memory:add',
  MEMORY_DELETE: 'memory:delete',

  // Claude Code Terminal PTY
  TERMINAL_SPAWN: 'terminal:spawn',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_OUTPUT: 'terminal:output',

  // Skills
  SKILLS_LIST: 'skills:list',
  SKILLS_INSPECT_GITHUB: 'skills:inspect-github',
  SKILLS_INSTALL: 'skills:install',
  SKILLS_DISCARD: 'skills:discard',
  SKILLS_REMOVE: 'skills:remove',
  COMMANDS_LIST: 'commands:list',
  AGENTS_LIST: 'agents:list',

  // Trust
  FILES_COMPLETE: 'files:complete',
  TRUST_GET: 'trust:get',
  TRUST_SET: 'trust:set',

  // Hooks
  HOOKS_GET: 'hooks:get',
  HOOKS_SAVE: 'hooks:save',

  // Providers (login buttons + 9router gateway)
  PROVIDERS_TEST: 'providers:test',
  PROVIDERS_OPEN: 'providers:open',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save'
} as const
