# AI Desktop

AI Desktop is a desktop application combining:
1. **Claude Desktop Shell**: Frameless Windows 11 titlebar, streaming chat, adaptive thinking block accordion, live MCP tool cards, Spotlight Quick Launcher (`Ctrl+Space`), and sandboxed interactive artifact viewer.
2. **Claude Code Execution Engine**: Real PTY terminal (`@lydell/node-pty`, `child_process` fallback), RTK (Rust Token Killer) output compression, permission modes, `hooks.json` hooks, context compaction, parallel read-only tool batches, `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` loading, and local markdown skills loader (`~/.claude/skills`).
3. **Antigravity Multi-Agent Architecture**: Autonomous loop with `builtin__update_plan`, self-healing hints on tool errors, and subagents (`builtin__spawn_agent`, depth 1, max 5 per run, optional git-worktree isolation).
4. **Codex Persistence & Context Slicing**: `apply_patch` (`*** Begin Patch`), goals with status and token budget plus auto-continuation, queued messages, and long-term memory extracted after each run. All state is JSON files in Electron `userData` (not SQLite).
5. **MCP Client**: Connects to any MCP server (stdio, SSE, streamable HTTP) with auto-reconnect and layered timeouts (`MCP_TIMEOUT` connect, default 90s; `MCP_TOOL_TIMEOUT` per call, default 120s). Server tools are offered to the model as `<server>__<tool>`.

---

## Quick Start

```powershell
# Install dependencies
npm install

# Run in Development mode
npm run dev

# Build production bundle
npm run build
```

---

## Keyboard Shortcuts
- `Ctrl + Space`: Toggle Spotlight Quick Launcher window
- `Enter`: Send message
- `Shift + Enter`: Multi-line prompt

---

## MCP Servers
No server is bundled. Add servers in **Settings → MCP Servers** by pasting a `claude_desktop_config.json`-style snippet or a GitHub URL, or point `mcpConfigPath` at an existing config file. Each server's tools appear as `<server>__<tool>`; the server's `readOnlyHint`/`destructiveHint` annotations decide whether a call needs approval.

---

## Configuration (files in Electron `userData`)
- **Permission mode** (Settings): `default` asks for non-read-only tools, `acceptEdits` auto-allows edits, `plan` is read-only, `bypass` allows all. Deny rules always win.
- `permissions.json`: `{"allow": [], "deny": []}`, entries are a tool name or `tool:firstWord` (e.g. `bash:git`). "Always allow" on an approval card appends here.
- `hooks.json`: `PreToolUse` / `PostToolUse` / `Stop` command hooks. Payload on stdin as JSON; exit code 2 blocks and sends stderr to the model.
