# Antigravity 2.24.0 dan Codex 0.153.2 - catatan RE

Hanya nama, alur, dan parameter yang dicatat. Tidak ada kode atau prompt panjang disalin.

## Antigravity
- `app.asar` Electron tipis (dist + tray). Logika agent ada di `resources\bin\language_server.exe` (Go, 171 MB).
- Tool agent (frekuensi string): view_file, run_command, write_to_file, read_url_content, grep_search, search_web, generate_image, replace_file_content, multi_replace_file_content, list_dir, command_status, send_command_input, browser_subagent, task_boundary, notify_user, view_code_item, find_by_name, read_terminal, list_resources, read_resource, view_file_outline.
- Pola artifact dokumen: `task.md` (checklist, `[ ]` / `[/]` sedang jalan / `[x]` selesai, diperbarui saat bekerja), `implementation_plan.md` (rencana untuk persetujuan user sebelum eksekusi, level requirement), `walkthrough.md` (ringkasan hasil). Task dibuat setelah plan disetujui.
- `command_status` + `send_command_input` = perintah shell berjalan di background, dipoll dan diberi input.
- `task_boundary` = penanda fase kerja, `notify_user` = minta review/persetujuan.
- Skill bawaan: agy-customizations, antigravity_guide, automation (cron sidecar), generative_ui, migrate-workflows, permissioned-github, plugin, ui-plugin-navigation. Format `SKILL.md` + frontmatter `name`, `description`, opsional `metadata`.
- State: `~\.gemini\antigravity\brain` (artifact per percakapan), `conversations\<id>.db` (sqlite per percakapan), `conversation_summaries.db`.

## Codex
- Binary: `@openai\codex-win32-x64\vendor\...\codex.exe`. Config `config.toml`: `approval_policy`, `sandbox_mode`, `model_reasoning_effort`, `[agents]`, `[mcp_servers.*]`, `[model_providers]`, `[projects."<path>"] trust_level`, timeout MCP (`startup_timeout_sec`, `tool_timeout_sec`).
- Approval policy: `untrusted`, `on-request`, `on-failure`, `never`, `granular`.
- Sandbox: `read-only`, `workspace-write`, `danger-full-access`.
- Tool: apply_patch, update_plan, exec_command/unified_exec + write_stdin (sesi shell interaktif), request_user_input, spawn_agent / wait_agent / close_agent, view_image, web_search, shell_command.
- Hook event: SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop, PermissionRequest, PreCompact, PostCompact.
- Skill sistem: imagegen, openai-docs, plugin-creator, review-agent (review read-only, defect-first), skill-creator, skill-installer. Format sama: `SKILL.md` + `name`/`description`.

## Dampak ke AI Desktop
1. Shell: bash tool perlu job background (command_status/write_stdin). Ditunda ke Fase 5.
2. Dokumen plan: `exit_plan_mode` menulis plan ke file, user approve sebelum eksekusi (pola implementation_plan.md).
3. Subagent: tambah wait/close (saat ini hanya spawn paralel).
4. `request_user_input`: tool bertanya ke user di tengah run. Fase 5.
5. Approval policy + sandbox: petakan `untrusted/on-request/never` ke mode permission yang ada.
6. Skill: satu format `SKILL.md` untuk ~/.claude, ~/.codex, ~/.gemini.
7. Trust per proyek (`[projects] trust_level`) sebelum membaca AGENTS.md/hook proyek.
