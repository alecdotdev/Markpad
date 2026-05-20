# Technology Stack

**Analysis Date:** 2026-05-20

## Languages

**Primary:**
- TypeScript ~5.6.2 — Frontend (SvelteKit UI, stores, utilities)
- Rust (edition 2021) — Backend/native layer via Tauri (`src-tauri/`)
- Svelte 5.x — UI component syntax (`.svelte` files in `src/`)

**Secondary:**
- JavaScript (ES modules) — Build config files (`vite.config.js`, `svelte.config.js`)

## Runtime

**Environment:**
- Node.js >=18 (CI uses Node 20 LTS; local runtime v22.22.1)
- Rust stable (managed via `dtolnay/rust-toolchain@stable` in CI)
- WebView2 (Windows), WebKitGTK 4.1 (Linux), WebKit (macOS) — provided by Tauri

**Package Manager:**
- npm (lockfile: `package-lock.json` present)
- Cargo (lockfile: `src-tauri/Cargo.lock` present)

## Frameworks

**Core (Frontend):**
- SvelteKit `^2.9.0` — Application framework (SPA mode via static adapter)
- Svelte `^5.0.0` — Component framework with runes (`$state`, `$derived`)

**Core (Backend/Native):**
- Tauri 2.x — Desktop app shell; `src-tauri/` contains the Rust binary

**Build/Dev:**
- Vite `^6.0.3` — Frontend bundler, dev server on port 1420
- `@sveltejs/adapter-static ^3.0.6` — Builds to static files (`build/`) for Tauri embedding
- `@sveltejs/vite-plugin-svelte ^5.0.0` — Vite integration
- `@tauri-apps/cli ^2` — Tauri CLI orchestrates `npm run build` + Rust compilation

**Testing:**
- `svelte-check ^4.0.0` — TypeScript/Svelte type checking (not a test runner)
- `cargo test` — Rust unit tests in `src-tauri/`
- No JavaScript test runner detected (no Jest, Vitest, etc.)

## Key Dependencies

**Frontend — Critical:**
- `monaco-editor ^0.55.1` — Full VS Code editor embedded in the app (`src/lib/components/Editor.svelte`)
- `monaco-vim ^0.4.4` — Vim keybindings for Monaco
- `mermaid ^11.12.2` — Diagram rendering in preview (`src/lib/utils/markdown.ts`)
- `katex ^0.16.27` — LaTeX math rendering in preview
- `highlight.js ^11.11.1` — Syntax highlighting in preview
- `highlightjs-svelte ^1.0.6` — Svelte language support for highlight.js
- `dompurify ^3.3.1` — HTML sanitization for rendered Markdown output

**Tauri Plugins (JS side):**
- `@tauri-apps/api ^2` — Core IPC (`invoke`, `convertFileSrc`)
- `@tauri-apps/plugin-dialog ^2.5.0` — Native open/save file dialogs
- `@tauri-apps/plugin-clipboard-manager ^2.3.2` — Clipboard access
- `@tauri-apps/plugin-opener ^2` — Open URLs / reveal files in OS
- `@tauri-apps/plugin-process ^2.3.1` — App exit control
- `@tauri-apps/plugin-updater ^2.10.1` — In-app auto-update

**Rust — Critical:**
- `tauri 2` (feature: `protocol-asset`) — App framework core
- `comrak 0.18` — Markdown → HTML conversion with GFM extensions
- `notify 6` — Cross-platform filesystem watcher (`watch_file` command)
- `reqwest 0.12` — Async HTTP client for downloading VS Code themes from marketplace
- `regex 1` — Wikilinks/embed preprocessing in Markdown pipeline
- `arboard 3` — Clipboard read/write (text + image)
- `image 0.25` (feature: `png`) — PNG encoding for clipboard image paste
- `base64 0.22` — Image data encoding/decoding
- `font-kit 0.14` — System font enumeration for editor font picker
- `chrono 0.4` — Timestamps for file naming and registry install date
- `zip 2.1` — Unzipping `.vsix` VS Code extension packages
- `serde / serde_json 1` — JSON serialization for Tauri commands
- `opener 0.7` (feature: `reveal`) — OS file-reveal support

**Rust — Windows Only:**
- `winreg 0.52` — Windows Registry read/write for install/uninstall and Windows 11 detection
- `mslnk 0.1` — Creating Windows shell `.lnk` shortcuts for installer

**Rust — Build:**
- `tauri-build 2` — Build script for Tauri
- `tauri-plugin-single-instance 2` — Enforce single app instance
- `tauri-plugin-window-state >=2.2.2,<3` — Persist window size/position
- `tauri-plugin-prevent-default 2.0.0-rc.1` — Prevent default browser keyboard shortcuts
- `env_logger 0.11.8` / `log 0.4.29` — Logging infrastructure

## Configuration

**Frontend Build:**
- `vite.config.js` — Vite config; fixed dev port 1420
- `svelte.config.js` — SvelteKit with `adapter-static`, fallback to `index.html` (SPA mode)
- `tsconfig.json` — TypeScript strict mode, `moduleResolution: bundler`
- Path alias `$lib` → `src/lib/` (SvelteKit default)

**Tauri:**
- `src-tauri/tauri.conf.json` — App identifier `com.alecdotdev.markpad`, CSP policy, file associations for `.md`, `.markdown`, `.txt`, updater endpoint URL, bundle targets
- `src-tauri/capabilities/default.json` — Tauri v2 capability grants (opener, dialog, window controls, updater, process)

**Environment:**
- No `.env` files required at runtime; all secrets are GitHub Actions secrets
  (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `CHOCO_API_KEY`, `SNAPCRAFT_STORE_CREDENTIALS`)

## Platform Requirements

**Development:**
- Node.js >=18
- Rust stable toolchain
- Linux: `libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxcb*-dev` (see `.github/workflows/test.yml`)

**Production Targets (all built in CI via `.github/workflows/build.yml`):**
- Windows x64 / ARM64 — `.exe` portable + NSIS installer + Chocolatey package
- macOS universal (x86_64 + aarch64) — `.dmg` + `.app` bundle
- Linux x86_64 — `.deb`, `.rpm`, `.AppImage`, Snap

---

*Stack analysis: 2026-05-20*
