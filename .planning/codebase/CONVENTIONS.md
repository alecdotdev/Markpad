# Coding Conventions

**Analysis Date:** 2026-05-20

## Naming Patterns

**Files:**
- Svelte components: PascalCase with `.svelte` extension — `Editor.svelte`, `TitleBar.svelte`, `FindBar.svelte`
- Svelte 5 rune stores: camelCase with `.svelte.ts` double extension — `tabs.svelte.ts`, `settings.svelte.ts`, `update.svelte.ts`
- Utility modules: camelCase with `.ts` extension — `markdown.ts`, `export.ts`, `theme.ts`, `i18n.ts`
- Routes: SvelteKit convention — `+page.svelte`, `+layout.ts`
- Rust files: snake_case — `lib.rs`, `main.rs`, `setup.rs`

**Functions:**
- TypeScript/Svelte: camelCase — `resolvePath`, `isYoutubeLink`, `processMarkdownHtml`, `exportAsHtml`
- Svelte event handlers in `$props`: lowercase with `on` prefix — `onsave`, `onnew`, `onopen`, `ontoggleEdit`, `onscrollsync`
- Rust: snake_case — `atomic_write`, `convert_markdown`, `process_wikilinks`, `process_internal_embeds`
- Tauri commands (Rust): snake_case — `read_file_content`, `save_file_content`, `open_markdown`

**Variables:**
- TypeScript: camelCase — `tabManager`, `updateStore`, `markdownBody`, `renderDebounceMs`
- Rust: snake_case — `watcher_lock`, `path_to_watch`, `app_handle`
- Constants: SCREAMING_SNAKE_CASE in both languages — `FIND_MARK_CLASS`, `MAX_MATCHES`, `DEBOUNCE_MS`, `APP_NAME`, `EXE_NAME`

**Types and Interfaces:**
- TypeScript interfaces: PascalCase — `Tab`, `ExportContext`, `Translation`, `DefaultFonts`
- TypeScript type aliases: PascalCase — `OSType`, `LanguageCode`, `UpdatePhase`, `ErrorSource`
- Rust structs: PascalCase — `WatcherState`, `AppState`, `InstallStatus`
- Union string literal types used for discriminated state — `UpdatePhase`, `ErrorSource`

**Classes (Svelte Stores):**
- Store classes are named with `Store` or `Manager` suffix — `TabManager`, `SettingsStore`, `UpdateStore`
- Exported as singleton `const` instances — `export const tabManager = new TabManager()`, `export const settings = new SettingsStore()`

## Code Style

**Formatting:**
- No `.prettierrc` or `biome.json` detected — no enforced formatter configured
- Indentation: tabs in `.svelte` files; the codebase mixes tabs and spaces in TypeScript (tabs are dominant)
- Svelte components use TypeScript strictly: `<script lang="ts">` on every component

**TypeScript strictness:**
- `strict: true` in `tsconfig.json` — all strict type checks enabled
- `allowJs: true` with `checkJs: true` — JavaScript files are also type-checked
- `skipLibCheck: true` — library declaration files are not checked
- `moduleResolution: "bundler"` — SvelteKit/Vite bundler resolution

**Linting:**
- No ESLint or Biome config detected — no enforced lint rules
- `svelte-check` is the only static analysis tool (runs TypeScript + Svelte checks)
- Run via: `npm run check` or `npm run check:watch`

## Import Organization

No enforced order, but observed pattern across files:

**Svelte components (`<script lang="ts">`):**
1. Svelte core imports — `onMount`, `onDestroy`, `tick`, `untrack`
2. Tauri API imports — `@tauri-apps/api/core`, `@tauri-apps/api/event`, plugins
3. Third-party library imports — `monaco-editor`, `dompurify`, `highlight.js`
4. Internal store imports — `../stores/tabs.svelte.js`, `../stores/settings.svelte.js`
5. Internal component imports — `./ContextMenu.svelte`, `../components/Editor.svelte`
6. Internal utility imports — `../utils/i18n.js`, `../utils/markdown`
7. CSS imports at end — `import 'highlight.js/styles/github-dark.css'`

Note: `MarkdownViewer.svelte` has inconsistent import ordering (some imports scattered mid-block), indicating this is not enforced.

**Path Aliases:**
- `$lib` alias maps to `src/lib/` (SvelteKit default)
- Relative imports use `.js` extension even for TypeScript sources (SvelteKit ESM requirement) — `import { t } from '../utils/i18n.js'`

## Svelte 5 Rune Patterns

The entire frontend uses **Svelte 5 runes** exclusively. No legacy `writable`/`readable` stores.

**Reactive state:**
```typescript
// In class-based stores (.svelte.ts files)
class TabManager {
    tabs = $state<Tab[]>([]);
    activeTabId = $state<string | null>(null);
}

// In Svelte components
let query = $state('');
let caseSensitive = $state(false);
```

**Side effects:**
```typescript
$effect(() => {
    localStorage.setItem('editor.minimap', String(this.minimap));
    // ... persist all settings on any reactive change
});

// Scoped effects in class constructors use $effect.root
$effect.root(() => {
    $effect(() => { /* ... */ });
});
```

**Component props:**
```typescript
let {
    value = $bindable(),
    language = 'markdown',
    onsave,
    onnew,
} = $props<{
    value: string;
    language?: string;
    onsave?: () => void;
    onnew?: () => void;
}>();
```

**Bindable props:**
- `$bindable()` used for two-way binding: `value = $bindable()`, `zoomLevel = $bindable()`

## Tauri IPC Pattern

**Frontend calling Rust:**
```typescript
// Typed invoke with explicit cast
const result = await invoke<string>('get_os_type');

// With payload object (snake_case keys match Rust param names)
await invoke('save_file_content', { path: selected, content: fullHtml });

// Fire-and-forget with error suppression
invoke('watch_file', { path: filePath }).catch(console.error);
```

**Rust command declaration:**
```rust
#[tauri::command]
fn save_file_content(path: String, content: String) -> Result<(), String> {
    atomic_write(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}
```

All Tauri commands return `Result<T, String>` — errors are always stringified with `.map_err(|e| e.to_string())`.

## Error Handling

**Rust:**
- Tauri commands consistently return `Result<T, String>` with `.map_err(|e| e.to_string())`
- Internal helper functions use `std::io::Result<T>`
- `unwrap()` used on static regex patterns (intentional panic on bad literal regex)
- `unwrap_or` and `unwrap_or_else` used for optional defaults, not panics
- Platform-specific no-op stubs for non-Windows commands return `Ok(())` directly

**TypeScript/Svelte:**
- Async functions wrapped in `try/catch` (49 try blocks across the codebase)
- Errors logged via `console.error(...)` — no structured error reporting
- Non-critical failures use `.catch(console.error)` chained inline
- `invoke()` calls in event handlers typically use `.catch(console.error)` pattern
- Store operations with critical data use full try/catch blocks

## Logging

**Rust:**
- `println!()` used directly throughout `setup.rs` for install progress — no structured logger (`env_logger` is a dependency but not actively used in code paths)
- Debug output uses `println!("Setup Args: {:?}", args)` format

**Frontend:**
- `console.error()` used exclusively — no `console.log()` or `console.warn()` in production paths
- Errors always include a descriptive message: `console.error('Failed to load vscode themes:', e)`

## Comments

**When to comment:**
- Complex algorithmic logic gets block comments — `atomic_write` has an extensive header explaining all correctness guarantees
- Non-obvious `#[cfg(...)]` branches are explained inline
- Workarounds and edge cases documented at point of implementation

**JSDoc/TSDoc:**
- Not used — no `@param`, `@returns`, or `@type` annotations in TypeScript code

**Rust doc comments:**
- Block-level `///` doc comments used on `atomic_write` and complex private functions
- Inline `//` comments used for step-by-step logic within functions

## Function Design

**Size:**
- Svelte components handle UI logic inline (Editor.svelte is 1,228 lines, TitleBar.svelte 1,392 lines)
- Utility functions in `src/lib/utils/` are focused and small
- Rust Tauri command handlers are thin wrappers delegating to helpers

**Parameters:**
- Rust commands accept primitive types (`String`, `bool`, `Vec<u8>`) that serialize over IPC
- TypeScript context objects used for multi-param utility functions: `ExportContext` in `export.ts`

**Return Values:**
- Rust: `Result<T, String>` for fallible commands; primitive types for infallible ones
- TypeScript: `Promise<void>` for side-effect functions; typed return for data functions

## Module Design

**Exports:**
- Named exports throughout — no default exports except SvelteKit config files
- Singleton instances exported as `const`: `export const tabManager`, `export const settings`, `export const updateStore`
- Types/interfaces exported alongside their owning module (no separate `types.ts`)

**Barrel Files:**
- None — no `index.ts` files; every import uses a direct path

## Platform-Specific Code

**Rust:**
- `#[cfg(target_os = "windows")]` / `#[cfg(not(target_os = "windows"))]` used extensively for Windows-only install logic — 23 occurrences
- Non-Windows stubs always return `Ok(())` immediately
- `#[cfg(unix)]` used in `atomic_write` for directory fsync after rename
- `#[cfg(target_os = "macos")]` for macOS window decoration and menu setup

**TypeScript:**
- `OSType` union (`'macos' | 'windows' | 'linux' | 'unknown'`) from `settings.svelte.ts` used for platform branching
- Per-platform font defaults in `DEFAULT_FONTS` constant

---

*Convention analysis: 2026-05-20*
