<!-- refreshed: 2026-05-20 -->
# Architecture

**Analysis Date:** 2026-05-20

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      SvelteKit SPA (WebView / Tauri)                     │
├──────────────────────────┬──────────────────────────────────────────────┤
│   src/routes/+page.svelte│  src/lib/MarkdownViewer.svelte               │
│   (route entry, mounts   │  (main app shell — 3546 lines)               │
│    MarkdownViewer)        │  - tab lifecycle, file I/O orchestration,    │
│                           │    mode switching, event wiring              │
├──────────────────────────┴──────────────────────────────────────────────┤
│                         UI Components Layer                              │
│  src/lib/components/                                                     │
│  Editor · TitleBar · TabList · Tab · Settings · Modal · Toast           │
│  FindBar · Toc · ContextMenu · UpdateDialog · ZoomOverlay · HomePage    │
├─────────────────────────────────────────────────────────────────────────┤
│                         Stores Layer (Svelte 5 runes)                    │
│  src/lib/stores/                                                         │
│  tabManager (tabs.svelte.ts)  settings (settings.svelte.ts)             │
│                                updateStore (update.svelte.ts)            │
├─────────────────────────────────────────────────────────────────────────┤
│                         Utilities Layer                                  │
│  src/lib/utils/                                                          │
│  markdown.ts · theme.ts · export.ts · i18n.ts                           │
├───────────────────┬─────────────────────────────────────────────────────┤
│  Tauri IPC Bridge │  invoke() calls ↔ Rust #[tauri::command] handlers   │
│  (async, JSON)    │  listen() / emit() for Rust → frontend events       │
└───────────────────┴─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│                      Tauri / Rust Backend                                │
│  src-tauri/src/lib.rs  (all commands, file I/O, clipboard, theme,       │
│                          watcher, markdown conversion)                   │
│  src-tauri/src/setup.rs (Windows install/uninstall only)                │
│  src-tauri/src/main.rs  (binary entry — calls markpad_lib::run())       │
└─────────────────────────────────────────────────────────────────────────┘
                           ↓ native OS APIs
┌────────────┬──────────────┬────────────────┬────────────────────────────┐
│ Filesystem │  Clipboard   │ File watcher   │  Registry/Shortcuts (Win)  │
│ (atomic    │  (arboard)   │  (notify)      │  (winreg, mslnk)           │
│  write)    │              │                │                            │
└────────────┴──────────────┴────────────────┴────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `MarkdownViewer` | App shell: file open/save/close, tab lifecycle, event wiring, split view, drag-drop, auto-save | `src/lib/MarkdownViewer.svelte` |
| `Editor` | Monaco editor wrapper; vim mode, keybindings, image drop, scroll sync | `src/lib/components/Editor.svelte` |
| `TitleBar` | Custom window chrome, toolbar buttons, menu bar, tab strip host | `src/lib/components/TitleBar.svelte` |
| `TabList` | Tab strip with drag-to-reorder | `src/lib/components/TabList.svelte` |
| `Tab` | Individual tab pill (title, dirty indicator, close) | `src/lib/components/Tab.svelte` |
| `Settings` | Settings panel with editor/preview/appearance/files tabs | `src/lib/components/Settings.svelte` |
| `FindBar` | In-preview find/highlight bar | `src/lib/components/FindBar.svelte` |
| `Toc` | Table of contents sidebar derived from rendered HTML | `src/lib/components/Toc.svelte` |
| `Modal` | Generic unsaved-changes dialog | `src/lib/components/Modal.svelte` |
| `UpdateDialog` | In-app updater UI | `src/lib/components/UpdateDialog.svelte` |
| `HomePage` | Start screen with recent files | `src/lib/components/HomePage.svelte` |
| `Toast` | Non-blocking notification overlay | `src/lib/components/Toast.svelte` |
| `ZoomOverlay` | Full-screen image zoom | `src/lib/components/ZoomOverlay.svelte` |
| `ContextMenu` | Right-click menu with typed item list | `src/lib/components/ContextMenu.svelte` |
| `Installer` | Windows installer UI (shown in installer mode) | `src/lib/Installer.svelte` |
| `Uninstaller` | Windows uninstaller UI | `src/lib/Uninstaller.svelte` |
| `tabManager` | Reactive singleton — owns all tab state, navigation history, split state | `src/lib/stores/tabs.svelte.ts` |
| `settings` | Reactive singleton — all editor/preview preferences, persisted via localStorage | `src/lib/stores/settings.svelte.ts` |
| `updateStore` | Reactive singleton — wraps tauri-plugin-updater lifecycle | `src/lib/stores/update.svelte.ts` |
| Rust backend | All file I/O, markdown→HTML conversion (comrak), clipboard (arboard), file watcher (notify), theme persistence, Windows install | `src-tauri/src/lib.rs` |

## Pattern Overview

**Overall:** Tauri desktop app — Svelte 5 SPA in a WebView with a Rust process providing all native capabilities.

**Key Characteristics:**
- The SPA is compiled with `adapter-static` (no SSR, `ssr = false`); the Rust binary serves `index.html` as the WebView content
- All filesystem access, clipboard, and markdown rendering run in Rust over Tauri IPC; the frontend never calls Node.js APIs
- Global state is managed by three Svelte 5 rune-based class singletons exported as module-level constants (`tabManager`, `settings`, `updateStore`)
- Settings are **dual-persisted**: Svelte `$state` + `$effect` auto-sync to `localStorage`; theme preference additionally persists to `<appConfigDir>/theme.txt` via `save_theme` command
- The app has two run modes: normal (`mode = 'app'`) and Windows installer (`mode = 'installer'`); detected via CLI args and exe name at startup

## Layers

**Frontend Route Layer:**
- Purpose: SvelteKit route entry point; mounts the main component
- Location: `src/routes/`
- Contains: `+page.svelte` (mounts `<MarkdownViewer />`), `+layout.ts` (disables SSR)
- Depends on: `src/lib/MarkdownViewer.svelte`
- Used by: Tauri WebView

**App Shell Layer:**
- Purpose: Orchestrates all user interactions — file operations, tab management, view state, and IPC event wiring
- Location: `src/lib/MarkdownViewer.svelte`
- Contains: All `invoke()` / `listen()` calls for file I/O, all tab lifecycle logic, split view, drag-drop, auto-save, markdown rendering triggers
- Depends on: All stores, all UI components, all utilities, Tauri APIs
- Used by: `+page.svelte`

**UI Components Layer:**
- Purpose: Stateless/controlled UI widgets; receive props and fire callbacks
- Location: `src/lib/components/`
- Contains: 13 `.svelte` components (see table above)
- Depends on: stores (`tabManager`, `settings`) directly for derived display state; fire callbacks up to `MarkdownViewer` for mutations
- Used by: `MarkdownViewer.svelte`, `TitleBar.svelte`

**Stores Layer:**
- Purpose: Reactive global state with Svelte 5 `$state` runes inside classes
- Location: `src/lib/stores/`
- Contains: `tabs.svelte.ts`, `settings.svelte.ts`, `update.svelte.ts`
- Depends on: `@tauri-apps/api/core` (`invoke`) for OS type and updater; `localStorage` for persistence
- Used by: `MarkdownViewer`, all components, utilities

**Utilities Layer:**
- Purpose: Pure or near-pure functions; no Svelte reactivity
- Location: `src/lib/utils/`
- Contains: `markdown.ts` (HTML post-processing, path resolution, YouTube embeds), `theme.ts` (VS Code theme JSON → CSS vars + Monaco theme), `export.ts` (HTML/PDF export via dialog plugin), `i18n.ts` (26-language translation lookup)
- Depends on: `@tauri-apps/api/core`, `DOMPurify`, `monaco-editor`
- Used by: `MarkdownViewer`, `Editor`, `Settings`, stores

**Rust Backend:**
- Purpose: All native I/O, markdown→HTML conversion, install/uninstall, clipboard
- Location: `src-tauri/src/lib.rs`, `src-tauri/src/setup.rs`
- Contains: 30+ `#[tauri::command]` handlers; `WatcherState` (notify watcher), `AppState` (startup file path), `atomic_write()` helper
- Depends on: comrak, notify, arboard, image, font-kit, reqwest, zip, regex, chrono, opener; Windows-only: winreg, mslnk
- Used by: Tauri runtime (registered via `invoke_handler`)

## Data Flow

### Primary File Open Path

1. User clicks "Open File" → `MarkdownViewer` calls `selectFile()` using `@tauri-apps/plugin-dialog` `open()` (`src/lib/MarkdownViewer.svelte`)
2. `loadMarkdown(filePath)` calls `invoke('open_markdown_preview', { path, maxBytes: 50000 })` for fast initial render (`src/lib/MarkdownViewer.svelte`)
3. Rust `open_markdown_preview` reads file, calls `convert_markdown()` (comrak + wikilink/embed processing), returns `[html, content, isFull]` (`src-tauri/src/lib.rs`)
4. If file was truncated, frontend fires a second `invoke('open_markdown')` for the full file in background
5. `tabManager.addTab(path, content)` adds tab; `tabManager.updateTabContent(id, html)` stores rendered HTML (`src/lib/stores/tabs.svelte.ts`)
6. Svelte `$derived` values flow to `MarkdownViewer` template → `<Editor>` and preview `<div>` update reactively

### Editor Save Path

1. User presses Cmd/Ctrl+S → `saveContent()` in `MarkdownViewer`
2. If unsaved new file: `@tauri-apps/plugin-dialog` `save()` dialog to pick path
3. `invoke('save_file_content', { path, content })` → Rust `atomic_write()` (temp file + fsync + rename) (`src-tauri/src/lib.rs`)
4. `tabManager.setTabRawContent(id, raw)` clears dirty flag (`src/lib/stores/tabs.svelte.ts`)

### Auto-Save Path

1. `$effect` in `MarkdownViewer` watches `rawContent` changes per tab
2. Debounces 1500ms per tab via `autoSaveTimers` Map (keyed by tab ID)
3. Calls same `invoke('save_file_content')` path; sets `selfWriteUntilByPath` to suppress the file-watcher reload

### Live Mode File Watch Path

1. `invoke('watch_file', { path })` → Rust registers `notify::RecommendedWatcher` → stores in `WatcherState.watcher` Mutex (`src-tauri/src/lib.rs`)
2. On external file change, Rust emits `"file-changed"` event via `AppHandle.emit()`
3. Frontend `listen('file-changed', ...)` handler calls `loadMarkdown(currentFile)` if not self-write (`src/lib/MarkdownViewer.svelte`)

### Rust → Frontend Events

| Event | Emitted from | Handled in |
|-------|-------------|------------|
| `file-changed` | `watch_file` command handler (notify callback) | `MarkdownViewer` — reload current file |
| `file-path` | `setup()` on launch args; `single_instance` plugin callback | `MarkdownViewer` — open the file |
| `menu-*` (15 events) | `on_menu_event` handler (macOS native menu) | `MarkdownViewer` — route to action |
| `menu-check-updates` | `on_menu_event` | `MarkdownViewer` → `updateStore.openDialog()` |

**State Management:**
- `tabManager` owns all tab data (`Tab[]`, `activeTabId`) as Svelte 5 `$state`; components read via `$derived`
- `settings` owns all preferences as `$state`; a single root `$effect` syncs all keys to `localStorage` on any change
- `MarkdownViewer` holds UI-only local state (modal, context menu, toast array, zoom, drag state) as `$state`

## Key Abstractions

**Tab:**
- Purpose: Represents one open file or the home screen
- Type definition: `src/lib/stores/tabs.svelte.ts` (interface `Tab`)
- Fields: `path` (empty string = unsaved new file; `'HOME'` = home tab), `rawContent`, `content` (rendered HTML), `isDirty`, `isEditing`, `isSplit`, navigation `history[]` + `historyIndex`
- Special values: `path === 'HOME'` renders `<HomePage>` instead of editor/preview

**TabManager:**
- Purpose: Single class instance managing the full tab list with navigation history, split state, and scroll sync preferences
- Location: `src/lib/stores/tabs.svelte.ts`
- Pattern: Class with `$state` fields; exported as `tabManager` singleton

**SettingsStore:**
- Purpose: All user preferences with automatic localStorage persistence via `$effect.root`
- Location: `src/lib/stores/settings.svelte.ts`
- Pattern: Class with `$state` fields + toggle methods; exported as `settings` singleton; initializes OS type via `invoke('get_os_type')` to set platform-appropriate font defaults

**atomic_write:**
- Purpose: Durably writes files with temp-file + fsync + rename strategy; handles symlinks, permission preservation, POSIX dir fsync
- Location: `src-tauri/src/lib.rs:28`
- Used by: `save_file_content`, `save_file_binary` commands

## Entry Points

**Frontend:**
- Location: `src/routes/+page.svelte`
- Triggers: Tauri WebView loads `index.html`
- Responsibilities: Mounts `<MarkdownViewer />` with global CSS

**Backend binary:**
- Location: `src-tauri/src/main.rs`
- Triggers: OS process launch
- Responsibilities: Calls `markpad_lib::run()` from `src-tauri/src/lib.rs`

**Backend `run()`:**
- Location: `src-tauri/src/lib.rs:837`
- Triggers: Called from `main.rs`
- Responsibilities: Configures Tauri builder with plugins, managed state (`AppState`, `WatcherState`), registers all 30+ commands, sets up macOS native menu, handles macOS `RunEvent::Opened` for file association, builds and runs the application

**App Initialization (frontend):**
- Location: `src/lib/MarkdownViewer.svelte` `onMount` → `init()` async function
- Triggers: Component mount
- Responsibilities: `invoke('show_window')`, determines app mode, restores tab state from localStorage, wires all `listen()` event handlers, loads CLI-specified file

## Architectural Constraints

- **Single window:** The app enforces a single instance via `tauri-plugin-single-instance`; a second launch emits `file-path` to the existing window and exits
- **No SSR:** SvelteKit is configured with `ssr = false` and `adapter-static`; all code runs only in the WebView browser context
- **Global state:** `tabManager`, `settings`, `updateStore` are module-level singletons — importing any of these files shares the same instance across all consumers
- **Circular imports:** None detected
- **Threading:** Rust backend uses `Mutex<Option<RecommendedWatcher>>` for the file watcher singleton; file-read/write commands use `spawn_blocking` to avoid blocking the async runtime
- **Markdown rendering:** Always done in Rust via comrak; the frontend never renders markdown directly. `processMarkdownHtml()` in `src/lib/utils/markdown.ts` post-processes the Rust-produced HTML in the browser (resolves local paths via `convertFileSrc`, injects YouTube embeds, handles GitHub-style alerts, restores collapsed-header state)

## Anti-Patterns

### Direct Filesystem Access from Frontend

**What happens:** The frontend never calls `fs` or Node APIs — all file reads/writes go through `invoke()`.
**Why it's right:** Tauri's capability system controls which paths Rust can access; the WebView cannot bypass this.
**Pattern to follow:** Use `invoke('read_file_content', { path })`, `invoke('save_file_content', { path, content })` etc.

### State Mutation Outside tabManager / settings

**What happens:** Components call `tabManager.updateTabRawContent()`, `tabManager.setActive()`, etc. — never mutate `tabManager.tabs` array directly.
**Why it's wrong:** Direct array mutation bypasses `isDirty` tracking and history management in the store methods.
**Do this instead:** Call the named methods on `tabManager` — see `src/lib/stores/tabs.svelte.ts` for the full method list.

## Error Handling

**Strategy:** Rust commands return `Result<T, String>`; the frontend receives the error string as a rejected promise from `invoke()`.

**Patterns:**
- Rust: `.map_err(|e| e.to_string())` throughout `src-tauri/src/lib.rs`
- Frontend: `invoke(...).catch(console.error)` for non-critical operations; `try/catch` with `addToast()` for user-visible errors in `MarkdownViewer`
- Modal dialogs (`askCustom()`) used for save-conflict decisions before destructive operations

## Cross-Cutting Concerns

**Logging:** `console.error` in the frontend; `env_logger` / `log` crate in Rust (not widely used in current code)
**Validation:** DOMPurify sanitizes all Rust-rendered HTML before insertion via `$derived sanitizedHtml` in `MarkdownViewer`; custom `ALLOWED_URI_REGEXP` permits `asset:` and `tauri:` schemes for local files
**Authentication:** Not applicable — local desktop app with no network authentication
**Internationalization:** `t(key, language)` function from `src/lib/utils/i18n.ts`; 26 languages; language stored in `settings.language` and `localStorage`

---

*Architecture analysis: 2026-05-20*
