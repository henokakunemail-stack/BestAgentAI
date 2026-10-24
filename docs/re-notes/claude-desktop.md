# Claude desktop 3.1623.0.0 - catatan RE

Sumber: `app.asar` (Electron, vite build, 415 file di `.vite/build`). Integrity ASAR untuk 6 binary native mismatch (normal, signed ulang); byte dianggap untrusted. Hanya perilaku/nama yang dicatat, tidak ada kode disalin.

## Hook events (32)
PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit, UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, PermissionRequest, PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded, CwdChanged, FileChanged, DirectoryAdded, MessageDisplay.

## Permission modes
`default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`, `dontAsk` (varian skema berbeda-beda).
`bypassPermissions` dan `auto` diperlakukan sebagai set "tanpa prompt" terpisah.

## Built-in tools (nama)
Read, Write, Edit, MultiEdit, NotebookEdit, Glob, Grep, Bash, WebFetch, WebSearch, Task (subagent), TodoWrite, ExitPlanMode, Skill.
- Set read-only: Read, Grep, Glob.
- Set path-scoped (cek workspace): Read, Write, Edit, MultiEdit, NotebookEdit, Glob, Grep, WebFetch.

## Settings relevan
`autoCompactWindow` (number), `contextWindowByModel` (map model -> window), `effort` + `effortByModel`, `maxTurns`, `allowedModels`, `thinkingAlwaysOnModels`, `enableAdditionalDirectoriesClaudeMd`.
Slash command terlihat di bundle: `/compact`.

## Worktree
Lease per agent (`leasedBy`), cleanup saat SubagentStop bila worktree tidak berubah (hapus branch juga). Worktree yang berubah dipertahankan.

## Dampak ke AI Desktop
- Hooks: perluas dari 3 ke event inti (PreToolUse, PostToolUse(+Failure), UserPromptSubmit, SessionStart/End, Stop, SubagentStart/Stop, PreCompact/PostCompact, PermissionRequest/Denied).
- Mode permission: tambah `dontAsk` (tolak apa pun yang tidak di-allow, tanpa prompt).
- Tool: tambah MultiEdit, Skill, TodoWrite-style persist, ExitPlanMode.
- Compaction: window per-model (`contextWindowByModel`) dan ambang `autoCompactWindow` bisa dikonfigurasi.
- Worktree subagent: auto-cleanup bila tidak ada perubahan (saat ini tidak pernah dihapus).
