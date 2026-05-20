# External Integrations

**Analysis Date:** 2026-05-20

## APIs & External Services

**VS Code Marketplace (VSIX download):**
- Purpose: Fetch VS Code color themes by URL from vscodethemes.com, download and unzip `.vsix` packages
- Endpoint: `https://{publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/{publisher}/extension/{extension}/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`
- Rust command: `fetch_vscode_theme` in `src-tauri/src/lib.rs:433`
- HTTP client: `reqwest 0.12` (async GET, no auth)
- Parsing: `zip` crate extracts `extension/package.json` and theme JSON from `.vsix`

**GitHub Releases (auto-updater):**
- Purpose: In-app update checks and downloads
- Endpoint: `https://github.com/alecdotdev/Markpad/releases/latest/download/latest.json`
- Configured in: `src-tauri/tauri.conf.json` under `plugins.updater.endpoints`
- Plugin: `tauri-plugin-updater ^2` (JS: `@tauri-apps/plugin-updater`)
- Auth: Update packages verified by minisign public key (`pubkey` in `tauri.conf.json`)
- Update feed (`latest.json`) is generated and uploaded to GitHub Releases by `.github/workflows/build.yml`

**Google Fonts:**
- Purpose: Font loading in preview/editor CSS
- CSP: `style-src` allows `https://fonts.googleapis.com`, `font-src` allows `https://fonts.gstatic.com`
- Implementation: CSS `@import` in stylesheets — no JS API calls

**YouTube:**
- Purpose: Auto-embed YouTube links found in Markdown image/anchor tags
- URLs matched: `youtube.com/watch`, `youtu.be/`
- Rendered as: `<iframe src="https://www.youtube.com/embed/{id}">` via `src/lib/utils/markdown.ts:replaceWithYoutubeEmbed`
- CSP `frame-src` permits: `https://www.youtube.com https://www.youtube-nocookie.com`

## Data Storage

**Databases:**
- None. No SQL or NoSQL database.

**File Storage — Markdown/Text Files:**
- All document content stored as files on the local filesystem
- Read via Tauri command `read_file_content` (`src-tauri/src/lib.rs:313`)
- Written atomically via `save_file_content` / `save_file_binary` using `atomic_write()` (`src-tauri/src/lib.rs:28`) — write-to-temp-then-rename with `fsync`
- File rename: `rename_file` command (`src-tauri/src/lib.rs:333`)
- File delete: `delete_file` command (`src-tauri/src/lib.rs:787`)
- File copy: `copy_file` / `copy_file_to_img` commands (`src-tauri/src/lib.rs:796`, `749`)
- Directory listing: `list_directory_contents` command (`src-tauri/src/lib.rs:816`)
- Image saving: `save_image` decodes base64 and writes to a sibling image directory (`src-tauri/src/lib.rs:717`)
- Image directory cleanup: `cleanup_empty_img_dir` (`src-tauri/src/lib.rs:801`)

**App Configuration (Tauri config dir):**
- Theme preference: `{app_config_dir}/theme.txt` — plain text (`"light"`, `"dark"`, `"system"`)
- Downloaded VS Code themes: `{app_config_dir}/themes/{name}.json`
- Config dir resolved via `app.path().app_config_dir()` in `src-tauri/src/lib.rs`
- Platform locations:
  - Windows: `%APPDATA%\com.alecdotdev.markpad\`
  - macOS: `~/Library/Application Support/com.alecdotdev.markpad/`
  - Linux: `~/.config/com.alecdotdev.markpad/`

**Editor Settings (WebView localStorage):**
- Stored in WebView's `localStorage` (key prefix `editor.*`)
- Persisted keys include: `editor.minimap`, `editor.wordWrap`, `editor.lineNumbers`, `editor.vimMode`, `editor.statusBar`, `editor.wordCount`, `editor.renderLineHighlight`, `editor.showTabs`, `editor.restoreStateOnReopen`, `editor.zenMode`, `editor.highlightColor`, `editor.splitScrollSync`, and others
- Managed by: `src/lib/stores/settings.svelte.ts` and `src/lib/stores/tabs.svelte.ts`

**Window State:**
- Persisted automatically by `tauri-plugin-window-state` (size, position, maximized, visible, fullscreen)
- Stored in Tauri's app data directory by the plugin

**Caching:**
- None

## Authentication & Identity

**Auth Provider:**
- None. No user authentication. Fully offline-capable app.

## OS / Native Integrations

**Clipboard:**
- Text read/write: `arboard 3` crate via commands `clipboard_read_text`, `clipboard_write_text` (`src-tauri/src/lib.rs:622-631`)
- Image read: `clipboard_read_image` encodes clipboard image as base64 PNG; macOS Retina images are downscaled by 2x using Lanczos3 (`src-tauri/src/lib.rs:634`)
- Also available via Tauri plugin: `@tauri-apps/plugin-clipboard-manager` (JS side)

**Filesystem Watcher:**
- Library: `notify 6` (`RecommendedWatcher`)
- Used to detect external file changes while a file is open in the editor
- Commands: `watch_file` / `unwatch_file` (`src-tauri/src/lib.rs:338`, `370`)
- Emits Tauri event `"file-changed"` to the webview on any filesystem event for the watched path

**File Open/Reveal:**
- `opener::reveal(path)` opens the containing folder in the OS file manager (`open_file_folder`, `src-tauri/src/lib.rs:328`)
- `@tauri-apps/plugin-opener` opens URLs in the default browser and files with their default OS handler

**Native File Dialogs:**
- `@tauri-apps/plugin-dialog` (`save`, `open`) — used in `src/lib/utils/export.ts` for HTML/PDF export save dialogs

**System Fonts:**
- `font-kit 0.14` enumerates all OS font families
- Command `get_system_fonts` returns a sorted deduplicated list (`src-tauri/src/lib.rs:591`)
- Used in Settings UI for the editor font picker

**OS Detection:**
- `get_os_type` returns `"macos"` | `"windows"` | `"linux"` via `#[cfg]` attributes (`src-tauri/src/lib.rs:601`)
- `is_win11` reads Windows Registry `CurrentBuild` value to check build >= 22000 (`src-tauri/src/lib.rs:570`)

**Window Management:**
- Tauri-managed frameless/native window; macOS uses `TitleBarStyle::Overlay` with hidden title
- Window background color set from `theme.txt` preference before first paint (avoids white flash)
- macOS native menu bar built in `setup()` with File, Edit, Window, App submenus; menu events forwarded as Tauri events to the webview

**Single Instance:**
- `tauri-plugin-single-instance` ensures only one app process runs at a time
- If a second instance is launched with a file argument, the path is forwarded to the running window via `"file-path"` event and the window is focused

**macOS URL handler:**
- `RunEvent::Opened { urls }` handles macOS "Open With" / drag-to-dock events
- Emits `"file-path"` event to the webview with the resolved path (`src-tauri/src/lib.rs:1159`)

## Windows-Specific OS Integrations

**Installer / Uninstaller (self-contained — no external installer framework required):**
- Copies executable to `%LOCALAPPDATA%\Markpad\` (per-user) or `%ProgramFiles%\Markpad\` (all-users) — `src-tauri/src/setup.rs:159`
- Creates `.lnk` shortcuts on Desktop and Start Menu via `mslnk 0.1`
- Writes uninstall registry keys under `HKCU/HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Markpad`
- Registers `.md` and `.markdown` file associations in Registry (`Software\Classes\.md`, `Software\Classes\Markpad.File`) — `src-tauri/src/setup.rs:428`
- Self-uninstall via generated `.bat` + VBScript (`wscript`) to allow deleting the running EXE (`src-tauri/src/setup.rs:370`)

**NSIS Installer:**
- Also provided as a standard NSIS `.exe` installer (generated by Tauri's bundle system); `src-tauri/tauri.conf.json` references `hooks.nsi`

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Bugsnag, etc.)

**Logs:**
- Rust: `env_logger 0.11.8` / `log 0.4.29` crates; `println!` used for debug output in setup/install flows
- Frontend: `console.error` for rendering failures (Mermaid, KaTeX, image resolution)

## CI/CD & Deployment

**Hosting:**
- GitHub Releases — primary distribution for all platform binaries
- Chocolatey (`push.chocolatey.org`) — Windows package registry (published in CI)
- Snap Store — Linux snap package (published in CI via `snapcraft`)

**CI Pipeline:**
- GitHub Actions — `.github/workflows/build.yml` (manual trigger, builds all platforms in matrix)
- Test workflow — `.github/workflows/test.yml` (runs on PR: `svelte-check` + `cargo test`)
- Update feed workflow — generates `latest.json` from `.sig` artifacts and uploads to the GitHub Release

**Required CI Secrets:**
- `TAURI_SIGNING_PRIVATE_KEY` — minisign private key for signing update artifacts
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password for the signing key
- `CHOCO_API_KEY` — Chocolatey push API key
- `SNAPCRAFT_STORE_CREDENTIALS` — Snap Store credentials

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- Tauri updater polls `https://github.com/alecdotdev/Markpad/releases/latest/download/latest.json` on user-initiated update check

---

*Integration audit: 2026-05-20*
