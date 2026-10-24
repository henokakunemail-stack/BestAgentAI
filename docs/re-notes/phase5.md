# Phase 5

## Done
- `dontAsk` permission mode: anything not allowed is denied, never prompts (`permissionPolicy.decide`).
- Per-project trust (`agent/trust.ts`, `trust.json`): untrusted workspace loads no CLAUDE.md/AGENTS.md, agents, skills or commands. Banner in the UI.
- Checkpoints + `/rewind` (`agent/checkpoints.ts`): file snapshot before write_file/edit_file/apply_patch, once per file per turn, fail closed. Files changed via bash are not tracked.
- Background shell (`agent/bgJobs.ts`): `bash {run_in_background}`, `bash_output`, `bash_input`, `bash_kill`. Killed at run end and app quit.
- `request_user_input`: agent asks, UI card answers. Refused in subagents and `dontAsk`.
- `@file` attachments (`agent/attachments.ts`): `@path` in the prompt becomes a `<file>` block (text, 256 KB cap) or base64 image block (png/jpg/gif/webp, 5 MB cap). Only files inside the workspace. `@` autocomplete in `ChatInput`.
- MCP over HTTP/SSE (`mcp/mcpConfig.ts`): server entry with `url` (+ `type: "http" | "sse"`, `headers`). Default for `url` is streamable HTTP.
- Hook events: `SessionEnd`, `PermissionRequest` (can allow/deny for the user), `PermissionDenied`, `Notification`, `StopFailure`.
- Subagent worktree is removed when it changed nothing (clean tree, HEAD unchanged); otherwise kept and reported. No more empty-folder fallback.

## Backlog (score <= 5, not done)
- `contextWindowByModel` / `autoCompactWindow` (single `contextWindow` today)
- WebSearch tool (SDK 0.39 has no server tool types; needs upgrade or cast)
- plan written to `.ai-desktop/plans/*.md`
- fork session
- Codex `approval_policy` / `sandbox_mode` mapping (cosmetic, same as 4 modes)
- `wait_agent` / `close_agent`
- cron / automation sidecar
- `MultiEdit`, `NotebookEdit`

## Known gaps
- POSIX: background job kill only reaches the shell, not grandchildren (`bgJobs.ts` ponytail).
- `SessionEnd` fires on `/clear` and session delete, not on app quit.
- Manual UI run-through (`npm run dev`) not done yet.
