# Codebase Structure

**Analysis Date:** 2026-05-20

## Directory Layout

```
Markpad/                        # Project root
├── src/                        # SvelteKit frontend (TypeScript + Svelte 5)
│   ├── routes/                 # SvelteKit routes (single page)
│   │   ├── +page.svelte        # Route entry — mounts <MarkdownViewer />
│   │   └── +layout.ts          # Disables SSR globally
│   ├── lib/                    # All library code ($lib alias)
│   │   ├── MarkdownViewer.svelte   # Main app shell (3546 lines)
│   │   ├── Installer.svelte        # Windows installer UI
│   │   ├── Uninstaller.svelte      # Windows uninstaller UI
│   │   ├── components/             # UI component library
│   │   │   ├── Editor.svelte       # Monaco editor wrapper
│   │   │   ├── TitleBar.svelte     # Custom title bar + toolbar
│   │   │   ├── TabList.svelte      # Tab strip
│   │   │   ├── Tab.svelte          # Single tab pill
│   │   │   ├── Settings.svelte     # Settings panel
│   │   │   ├── FindBar.svelte      # In-preview search bar
│   │   │   ├── Toc.svelte          # Table of contents sidebar
│   │   │   ├── Modal.svelte        # Unsaved-changes dialog
│   │   │   ├── Toast.svelte        # Notification overlay
│   │   │   ├── ContextMenu.svelte  # Right-click menu
│   │   │   ├── UpdateDialog.svelte # In-app updater UI
│   │   │   ├── HomePage.svelte     # Start screen / recent files
│   │   │   └── ZoomOverlay.svelte  # Full-screen image zoom
│   │   ├── stores/                 # Svelte 5 rune-based global state
│   │   │   ├── tabs.svelte.ts      # Tab list, active tab, navigation history
│   │   │   ├── settings.svelte.ts  # All user preferences + localStorage sync
│   │   │   └── update.svelte.ts    # In-app updater state machine
│   │   └── utils/                  # Pure / near-pure utility functions
│   │       ├── markdown.ts         # HTML post-processing, path/YouTube helpers
│   │       ├── theme.ts            # VS Code theme JSON → CSS vars + Monaco
│   │       ├── export.ts           # HTML / PDF export helpers
│   │       └── i18n.ts             # 26-language translation function
│   ├── assets/                 # Static assets bundled with frontend
│   │   └── icon.png
│   ├── styles.css              # Global CSS (imported by +page.svelte)
│   ├── app.html                # SvelteKit HTML shell (theme flicker prevention)
│   └── globals.d.ts            # Global TypeScript declarations
├── src-tauri/                  # Tauri / Rust backend
│   ├── src/
│   │   ├── main.rs             # Binary entry point
│   │   ├── lib.rs              # All Tauri commands + app setup (1175 lines)
│   │   └── setup.rs            # Windows install/uninstall logic
│   ├── capabilities/           # Tauri v2 capability definitions (permissions)
│   ├── icons/                  # App icons (all platforms)
│   │   └── ios/
│   └── Cargo.toml              # Rust dependencies
├── static/                     # Files served as-is by Vite (favicon etc.)
├── packaging/                  # Distribution packaging
│   └── choco/                  # Chocolatey package spec (Windows)
│       └── tools/
├── samples/                    # Sample markdown files for testing
├── pics/                       # Screenshots for README
│   ├── 2.6.2/
│   └── 2.6.3/
├── .github/
│   ├── workflows/              # CI/CD GitHub Actions
│   └── ISSUE_TEMPLATE/
├── .planning/
│   └── codebase/               # GSD codebase map documents
├── .claude/
│   └── agents/                 # Claude agent skill files
├── package.json                # Node dependencies + scripts
├── package-lock.json
├── svelte.config.js            # SvelteKit config (adapter-static, SPA mode)
├── vite.config.js              # Vite config (port 1420, Tauri dev settings)
├── tsconfig.json               # TypeScript config
├── snapcraft.yaml              # Linux Snap package spec
├── AGENTS.md                   # AI agent instructions
└── RELEASING.md                # Release process notes
```

## Directory Purposes

**`src/routes/`:**
- Purpose: SvelteKit routing — only one route exists (the full-screen app)
- Contains: `+page.svelte` (mounts `MarkdownViewer`), `+layout.ts` (SSR disabled)
- Key files: `src/routes/+page.svelte`, `src/routes/+layout.ts`

**`src/lib/`:**
- Purpose: All frontend application code; accessible via the `$lib` path alias
- Contains: App shell, components, stores, utilities, top-level special screens
- Key files: `src/lib/MarkdownViewer.svelte` (primary), `src/lib/Installer.svelte`, `src/lib/Uninstaller.svelte`

**`src/lib/components/`:**
- Purpose: Reusable UI widgets; receive props, fire callbacks, no direct file I/O
- Contains: 13 `.svelte` files for all UI elements except the app shell
- Key files: `Editor.svelte`, `TitleBar.svelte`, `Settings.svelte`

**`src/lib/stores/`:**
- Purpose: Reactive global state using Svelte 5 runes (`$state`, `$effect`)
- Contains: Three class-based singletons exported as module-level constants
- Key files: `tabs.svelte.ts` (tab state), `settings.svelte.ts` (preferences)

**`src/lib/utils/`:**
- Purpose: Framework-agnostic helper functions
- Contains: Markdown post-processing, VS Code theme parsing, export logic, i18n
- Key files: `markdown.ts`, `theme.ts`, `export.ts`, `i18n.ts`

**`src-tauri/src/`:**
- Purpose: Entire Rust backend — native file I/O, clipboard, file watching, markdown rendering
- Contains: `lib.rs` (all commands + `run()`), `setup.rs` (Windows install), `main.rs` (binary entry)
- Key files: `src-tauri/src/lib.rs`

**`src-tauri/capabilities/`:**
- Purpose: Tauri v2 capability JSON files that define which APIs/paths the WebView may access
- Generated: No (hand-edited)
- Committed: Yes

## Key File Locations

**Entry Points:**
- `src/routes/+page.svelte`: Frontend SPA entry — mounts `<MarkdownViewer />`
- `src-tauri/src/main.rs`: Rust binary entry — calls `markpad_lib::run()`
- `src-tauri/src/lib.rs:837`: `pub fn run()` — Tauri builder, plugin registration, command handler registration

**Configuration:**
- `package.json`: Node scripts (`dev`, `build`, `tauri`)
- `svelte.config.js`: SvelteKit adapter (static, SPA fallback)
- `vite.config.js`: Dev server port 1420, Tauri-specific settings
- `tsconfig.json`: TypeScript settings
- `src-tauri/Cargo.toml`: Rust dependencies and release profile
- `snapcraft.yaml`: Linux Snap packaging

**Core Logic:**
- `src/lib/MarkdownViewer.svelte`: All file operations, IPC calls, tab lifecycle, auto-save
- `src-tauri/src/lib.rs`: All Rust commands — markdown conversion, atomic file write, clipboard, file watcher, theme persistence, VS Code theme download
- `src/lib/stores/tabs.svelte.ts`: Tab data model and mutation API
- `src/lib/stores/settings.svelte.ts`: All user preferences, localStorage persistence, OS-type detection

**Styling:**
- `src/styles.css`: Global styles (imported by `+page.svelte`)
- `src/app.html`: Theme-flicker prevention script inline in HTML shell
- Theme at runtime: CSS custom properties on `:root[data-theme]`; VS Code themes injected via `<style id="vscode-theme-style">` by `src/lib/utils/theme.ts`

## Naming Conventions

**Files:**
- Svelte components: `PascalCase.svelte` (e.g., `MarkdownViewer.svelte`, `TitleBar.svelte`)
- Svelte 5 store files: `camelCase.svelte.ts` (e.g., `tabs.svelte.ts`, `settings.svelte.ts`)
- Utility modules: `camelCase.ts` (e.g., `markdown.ts`, `theme.ts`, `i18n.ts`)
- SvelteKit route files: `+page.svelte`, `+layout.ts` (framework convention)

**Directories:**
- Frontend source directories: `lowercase/` (e.g., `components/`, `stores/`, `utils/`)
- Tauri backend: `src-tauri/` (Tauri convention, not frontend)

**Exports:**
- Stores: Named singleton constant (`export const tabManager = new TabManager()`)
- Utilities: Named function exports (`export function processMarkdownHtml(...)`)
- Types/interfaces: `PascalCase` (`Tab`, `SettingsStore`, `UpdatePhase`)

## Where to Add New Code

**New UI component:**
- Implementation: `src/lib/components/NewComponent.svelte`
- Import in consumer: `import NewComponent from '$lib/components/NewComponent.svelte'`

**New store (global reactive state):**
- Implementation: `src/lib/stores/newFeature.svelte.ts`
- Pattern: Class with `$state` fields + `$effect.root(() => { $effect(() => { /* localStorage sync */ }) })`

**New utility function:**
- Add to existing file if related (e.g., markdown helpers → `src/lib/utils/markdown.ts`), or
- Create `src/lib/utils/newUtil.ts`

**New Tauri command (Rust → frontend):**
1. Add `#[tauri::command]` function to `src-tauri/src/lib.rs`
2. Register it in `tauri::generate_handler![..., new_command]` inside `run()` at `src-tauri/src/lib.rs`
3. Emit events with `app_handle.emit("event-name", payload)` or `window.emit("event-name", payload)`
4. On frontend: `invoke('new_command', { arg })` from `@tauri-apps/api/core`

**New Tauri event listener (frontend):**
- Add `await listen('event-name', handler)` inside the `init()` async function in `src/lib/MarkdownViewer.svelte` (lines ~2257+)
- Push the returned unlisten function to `unlisteners` array for cleanup on destroy

**New feature with file I/O:**
- File operations: Add to `src-tauri/src/lib.rs` as a new command
- Do NOT use any JS filesystem APIs — all file access must go through Rust IPC

**New translation key:**
- Add to the translation objects inside `src/lib/utils/i18n.ts` for all 26 language codes
- Access via `t('key.path', settings.language)`

**Windows-only install logic:**
- Implementation: `src-tauri/src/setup.rs`

## Special Directories

**`src-tauri/capabilities/`:**
- Purpose: Tauri v2 permission capability definitions; controls WebView API access
- Generated: No
- Committed: Yes

**`src-tauri/icons/`:**
- Purpose: App icon assets for all platforms (PNG, ICNS, ICO) generated by Tauri toolchain
- Generated: Partially (from source icon)
- Committed: Yes

**`static/`:**
- Purpose: Files Vite copies verbatim to build output (favicon, etc.)
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents consumed by planning/execution agents
- Generated: By GSD map-codebase command
- Committed: Yes

---

*Structure analysis: 2026-05-20*
