# Fase B - Keandalan pipeline agen

Status: B1-B6 selesai di kode; typecheck, selfcheck, build hijau. Diuji lewat `scripts/mock-anthropic.mts` (tanpa API key nyata).

## Yang dibuat
| Id | Perubahan | File utama |
|----|-----------|------------|
| B1 | Abort sejak awal `run()`, hook/MCP/worktree menghormati `AbortSignal`, Stop hanya menjeda goal milik sesi, sesi di-claim `busy` sebelum `await` pertama | `agentRunner.ts`, `hooks.ts`, `mcpClientManager.ts`, `reaClient.ts`, `registerHandlers.ts` |
| B2 | `retryPolicy.ts` (classifyError, retryDelayMs, stopAction, backoffMs), SDK `maxRetries:0`, idle watchdog 90 s, `stream_reset`/`retrying`, penanganan `max_tokens`/`refusal`/`pause_turn`, pesan maxTurns | `retryPolicy.ts`, `agentRunner.ts`, `clientFactory.ts`, `App.tsx` |
| B3 | `modelLimits.ts`, estimasi token tanpa base64, breakpoint cache pesan, urutan tool stabil, `billableTokens`, `capTurnResults`, `pruneOldToolResults`, compaction dengan retry + reaktif saat overflow, gambar MCP sebagai blok `image` | `modelLimits.ts`, `compactor.ts`, `agentRunner.ts` |
| B4 | `splitCommand`/`ruleKeys` (rantai perintah, `$()`, backtick, redirect file), `decide` multi-kunci, aturan MCP ber-namespace, `canAlways`, `spawn_agent` tidak read-only | `permissionPolicy.ts`, `permissionGate.ts`, `builtinTools.ts`, `ToolCallBlock.tsx` |
| B5 | `onclose`/`onerror`, reconnect backoff maks 8x, `tools/list_changed`, retry baca-saja saat putus, `dispose()` | `mcpClientManager.ts`, `index.ts` |
| B6 | Delete sesi menghentikan run dan membersihkan map, terminal idempoten dengan cwd workspace, `SessionEnd` saat `before-quit` (batas 3 s), `abortAll()` | `registerHandlers.ts`, `ptyManager.ts`, `index.ts` |

## Terverifikasi runtime (app asli + mock, CDP)
- 429 + `retry-after: 1` -> satu retry, jeda 1 s, teks akhir benar.
- Socket diputus di tengah SSE -> `stream_reset` + retry sukses (bug ditemukan: `Premature close` tidak dianggap retry; diperbaiki + assert).
- Stream diam -> idle watchdog (uji 2 s) -> retry.
- `stop_reason: max_tokens` dengan tool_use terpotong -> tool tidak jalan, turn berikutnya sukses.
- 401 -> error langsung, tanpa retry.
- `maxTurns` habis -> pesan eksplisit.
- Request mock memuat 3 `cache_control` (system, tool terakhir, pesan terakhir), `max_tokens` 16000, urutan 33 tool stabil.
- `git status && echo hi` -> prompt tanpa tombol "always" (`canAlways:false`); `git status` -> `canAlways:true`.
- Stop tepat setelah kirim (fase persiapan) -> `aborted`+`done`, mock tidak menerima request (bug ditemukan: sesi belum `busy` saat Stop tiba; diperbaiki).
- Hapus sesi saat stream menggantung -> run berhenti, sesi hilang dari daftar dan riwayat, ~100 ms.

## Belum diverifikasi
- Panggilan model nyata (butuh key). Perilaku `cache_control`/`refusal` via 9router non-Claude tidak diuji.
- Skenario overflow 400 (`SOVER`) -> prune+compact -> ulang: logika ada, mock siap, belum dijalankan end-to-end.
- Gambar MCP -> blok `image`; usage `cache_read` terhitung 10% pada budget goal (hanya selfcheck).
- Reconnect MCP (kill proses stdio), `list_changed`, retry baca-saja saat putus: hanya typecheck.
- Terminal idempoten (5x spawn = 1 proses) dan `SessionEnd` saat quit: hanya typecheck.
- Jalur `/rewind` setelah compaction (B3 butir 10, indeks checkpoint): ditunda; `listTurns` sudah memfilter turn yang tak cocok dengan pesan di indeks itu.

## Anomali terbuka
- `deleteSession` saat run menggantung: ~0.1 s pada uji tunggal, tetapi ~4 s pada uji dua sesi (sesi A di-abort saat persiapan, lalu sesi B dihapus). Hasil benar (run berhenti, sesi hilang). Penyebab belum ditemukan; kandidat: loop tunggu `busy` (50x100 ms) atau hook `SessionEnd`.

## Batas yang disengaja
- `limitsFor`: `contextWindow` setting selain 200000 dianggap override pengguna (tidak ada toggle "auto" terpisah).
- Variabel `VAR=x cmd` pada command selalu minta persetujuan (tidak ada kunci aturan), lebih ketat dari rencana awal yang mengupas prefix.
- Retry bacaan MCP hanya untuk tool yang lolos `isReadOnly` (berdasar nama).
