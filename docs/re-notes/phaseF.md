# Fase F - Install skills dan MCP dari GitHub

Status: selesai di kode. typecheck, selfcheck, build hijau. Diuji lewat app asli (CDP) dengan repo git lokal dan server MCP stdio uji. Belum diuji ke github.com sungguhan.

## Yang dibuat
| Bagian | Isi | File |
|--------|-----|------|
| Parser murni | `parseGithubUrl` (hanya https://github.com, tolak `..`, userinfo, port), `isSafeSkillName`, `isInside`, `parseMcpSnippet` (3 bentuk JSON), `stableJson`, `maskConfig` | `src/main/install/githubSource.ts` |
| Skill | `git clone --depth 1` ke temp (`GIT_TERMINAL_PROMPT=0`, tanpa shell, symlink dilewati), cari `SKILL.md` di `.`, `skills/*`, `.claude/skills/*`, `.codex/skills/*`, preview, token sekali pakai (5 menit), salin lewat folder staging + rename, `.source.json` | `src/main/install/skillInstaller.ts` |
| MCP | tulis `ai_desktop_config.json` atomik (`addServerConfigs`, `removeServerConfig`), file korup tidak lagi ditimpa sample, server yang config-nya berubah di-restart, status memuat config bertopeng | `mcp/configWatcher.ts`, `mcp/mcpClientManager.ts` |
| IPC | `skills:inspect-github/install/discard/remove`, `mcp:preview/add/remove/inspect-github` | `ipc/channels.ts`, `ipc/registerHandlers.ts`, `preload/*` |
| UI | "Install from GitHub" (pilih kandidat, baca `SKILL.md`, badge scripts, pilih scope), "Add server" (paste JSON atau muat `.mcp.json` dari repo, preview bertopeng + peringatan), tombol hapus di kartu MCP dan chip skill | `settings/InstallPanels.tsx`, `McpServerCard.tsx`, `SettingsModal.tsx` |

## Aturan keamanan yang dipasang
- Sumber hanya github.com. Path lokal hanya bila env `AI_INSTALL_ALLOW_FILE=1` (untuk uji).
- Tidak ada yang dijalankan dari repo: skrip hanya disalin dan ditandai. MCP: tidak ada `npm install`/build otomatis.
- Install butuh token dari langkah preview (main yang memegang hasil clone, renderer tidak bisa menyerahkan path sendiri). Token dipakai sekali, kedaluwarsa 5 menit, dibersihkan saat quit.
- Batas 200 file dan 5 MB per skill. Nama skill/server hanya `[\w.-]`.
- Skill yang dibuat tangan (tanpa `.source.json`) tidak pernah ditimpa atau dihapus oleh app.
- Nilai `env`/`headers` MCP tidak pernah dikirim ke renderer (hanya nama kunci).

## Terverifikasi
- Selfcheck: parser URL (tolak host palsu, `..`, userinfo, port), nama aman, `isInside`, snippet MCP valid/invalid, `stableJson`, masking, dan alur lengkap dengan repo git sementara (kandidat, token palsu/kedaluwarsa, install, overwrite, hapus, skill buatan tangan aman, path lokal mati secara default).
- App asli via CDP: preview tidak membocorkan nilai env; token palsu dan token yang dipakai ulang ditolak; server stdio uji `connected` dengan 1 tool; snippet `ftp://` ditolak; URL non-GitHub ditolak; install skill ke HOME sementara, muncul di `skills.list`, hapus bekerja, `../x` ditolak; hapus server MCP bekerja.

## Belum diverifikasi / batas
- Clone dari github.com sungguhan dan `.mcp.json` publik nyata (butuh izin jaringan dari user).
- Eksekusi tool MCP pihak ketiga dan `npx` polos di Windows (server uji memakai `node`).
- Env/headers MCP tetap plaintext di `ai_desktop_config.json` (enkripsi `safeStorage` belum).
- Tidak ada auto-update, pencarian katalog, atau OAuth MCP remote.
- Cabang yang mengandung `/` di nama branch pada URL `/tree/...` terbaca sebagai ref satu segmen; pakai `owner/repo/path` untuk kasus itu.
- Catatan uji: argumen `--user-data-dir` dengan spasi lewat `Start-Process` terpotong sehingga app memakai `D:\Henok\Projects\Agent` sebagai userData (folder sementara itu sudah dihapus). `%APPDATA%\ai-desktop` tidak berubah (mtime 21 Okt).
