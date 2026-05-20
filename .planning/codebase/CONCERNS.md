# Codebase Concerns

**Analysis Date:** 2026-05-20

## Tech Debt

**Duplicate processing functions between MarkdownViewer.svelte and markdown.ts:**
- Issue: `processBlockIds`, `processTaskItems`, `getLanguage`, and the full `renderRichContent` function are each defined in both `src/lib/MarkdownViewer.svelte` and `src/lib/utils/markdown.ts`. The two implementations have diverged slightly (e.g., the task-item wrapping logic in MarkdownViewer is a simplified older version compared to the more accurate version in markdown.ts).
- Files: `src/lib/MarkdownViewer.svelte` (lines 325, 385, 434, 581), `src/lib/utils/markdown.ts` (lines 67, 248, 394, 733)
- Impact: Bug fixes applied to one file do not propagate to the other. Already caused at least one diverged behavior in task checkbox rendering.
- Fix approach: Remove inline duplicates from `MarkdownViewer.svelte` and import the canonical versions from `src/lib/utils/markdown.ts`.

**MarkdownViewer.svelte monolith (3546 lines):**
- Issue: The main component is a 3546-line file mixing state management, event handling, markdown rendering pipeline, file I/O orchestration, drag-and-drop, clipboard, scroll sync, task editing, TOC, find-bar coordination, and zoom overlay. No clear separation of concerns.
- Files: `src/lib/MarkdownViewer.svelte`
- Impact: Hard to navigate, test, or modify without side effects. Changes to one feature risk breaking unrelated behaviour.
- Fix approach: Extract sub-concerns into dedicated components or composable stores (e.g., a `FileManager` module, a `ScrollSync` module, a dedicated `renderRichContent` service).

**Unused npm dependencies:**
- Issue: `node-stream-zip` and `@tauri-apps/plugin-clipboard-manager` are declared in `package.json` but are not imported anywhere in the frontend source. VSIX unpacking is done entirely by the Rust `zip` crate; clipboard operations go through custom Rust commands.
- Files: `package.json` (lines 18, 31)
- Impact: Increases bundle analysis noise and install time. `clipboard-manager` plugin may register unnecessary Tauri permissions.
- Fix approach: Remove both entries from `package.json` and run `npm install` to update the lockfile.

**`env_logger` declared but never initialised:**
- Issue: `env_logger = "0.11.8"` and `log = "0.4.29"` are declared in `src-tauri/Cargo.toml` but `env_logger::init()` is never called and `log::` macros are not used. All current logging is done via `println!`.
- Files: `src-tauri/Cargo.toml` (lines 44-45), `src-tauri/src/lib.rs`, `src-tauri/src/setup.rs`
- Impact: Cargo pulls in two crates for no benefit. Replacing `println!` calls with `log::info!` / `log::debug!` would give proper log-level filtering in production.
- Fix approach: Either remove both crates and keep `println!` or call `env_logger::init()` in `run()` and migrate `println!` to `log` macros.

**resolvePath duplicated in multiple files:**
- Issue: `resolvePath` is defined both as an export in `src/lib/utils/markdown.ts` (line 29) and as a local private function in `src/lib/MarkdownViewer.svelte` (line 1229). The two implementations are identical.
- Files: `src/lib/utils/markdown.ts` (line 29), `src/lib/MarkdownViewer.svelte` (line 1229)
- Impact: Maintenance burden; any path-resolution fix must be applied twice.
- Fix approach: Delete the local definition in `MarkdownViewer.svelte` and import from `src/lib/utils/markdown.ts`.

---

## Security Considerations

**comrak `unsafe_` HTML rendering enabled:**
- Risk: `options.render.unsafe_ = true` in `src-tauri/src/lib.rs` (line 260) tells comrak to pass raw HTML from the Markdown document through to the output without stripping it. Any raw `<script>`, `<iframe>`, or event-handler attribute embedded in a `.md` file will be emitted verbatim into the HTML that the WebView renders.
- Files: `src-tauri/src/lib.rs` (line 260)
- Current mitigation: The rendered HTML is subsequently sanitised by DOMPurify in the frontend (`src/lib/MarkdownViewer.svelte` line 168, `src/lib/utils/markdown.ts` line 767). DOMPurify strips `<script>` and inline handlers, so XSS risk is mitigated for the preview pane.
- Remaining risk: The HTML export path (`src/lib/utils/export.ts` line 68) writes `markdownBody.innerHTML` to disk — the already-processed DOM. If DOMPurify is bypassed for any reason (race condition, future refactor), unsafe markup reaches the exported file. The HTML export does not re-sanitise.
- Recommendations: Consider disabling `unsafe_` in comrak and relying on comrak's own sanitisation. If raw HTML must be allowed, add an explicit DOMPurify pass in `exportAsHtml` before writing to disk.

**`{@html tooltip.html}` renders unsanitised footnote HTML:**
- Risk: At `src/lib/MarkdownViewer.svelte` line 2850, `{@html tooltip.html}` injects `fnHtml` (line 1863) which is `clone.innerHTML.trim()` — the raw inner HTML of a `<li>` element taken directly from the rendered DOM. Although the DOM was sanitised earlier by DOMPurify, any post-sanitisation DOM mutation (e.g., by mermaid, highlight.js, or task-checkbox processing) could insert nodes that are then re-injected without a second sanitisation pass.
- Files: `src/lib/MarkdownViewer.svelte` (lines 1863, 2850)
- Current mitigation: The source node is already in the sanitised DOM; exploitability is low for typical local files.
- Recommendations: Pass `fnHtml` through `DOMPurify.sanitize()` before assigning to `tooltip.html`.

**`{@html html}` in ZoomOverlay for SVG content:**
- Risk: `src/lib/components/ZoomOverlay.svelte` (line 90) renders `{@html html}` which comes from a cloned SVG's `outerHTML` (`src/lib/MarkdownViewer.svelte` line 1140). Mermaid-generated SVGs may contain embedded `<script>` or `<foreignObject>` nodes.
- Files: `src/lib/components/ZoomOverlay.svelte` (line 90), `src/lib/MarkdownViewer.svelte` (line 1140)
- Current mitigation: Mermaid SVGs are sanitised by DOMPurify before insertion (MarkdownViewer.svelte line 612), but the zoom path clones from the DOM after rendering, which may include content added by Mermaid's post-render step.
- Recommendations: Sanitise `clone.outerHTML` with `DOMPurify.sanitize(...)` before setting `zoomData.html`.

**Unvalidated URL in `fetch_vscode_theme`:**
- Risk: The Rust command at `src-tauri/src/lib.rs` line 455 constructs a VSIX download URL by string-interpolating `publisher` and `extension` extracted from a user-supplied URL. No allowlist or regex validation is applied to these substrings before they are embedded into the download URL and passed to `reqwest::get`. A crafted URL could redirect the download to an arbitrary server.
- Files: `src-tauri/src/lib.rs` (lines 437-457)
- Current mitigation: Only the vscodethemes.com URL format is parsed; the resulting download goes to `vsassets.io`.
- Recommendations: Validate that `publisher` and `extension` match `[a-zA-Z0-9_-]+` before use. Restrict the outbound domain to `*.vsassets.io` or `*.gallery.vscdn.net`.

**Windows uninstaller uses a user-writable temp directory for batch/VBS scripts:**
- Risk: `src-tauri/src/setup.rs` (lines 393-412) writes a `.bat` file and a `.vbs` file to `env::temp_dir()` with predictable names (`uninstall_markdown_viewer.bat/vbs`). A local attacker with write access to `%TEMP%` could replace the file between creation and execution (TOCTOU).
- Files: `src-tauri/src/setup.rs` (lines 393-412)
- Current mitigation: None; the path is fixed.
- Recommendations: Use a randomly named subdirectory in `%TEMP%`, or use `tempfile::NamedTempFile` for atomic creation.

---

## Performance Bottlenecks

**Markdown re-render on every keystroke (50 ms debounce):**
- Problem: `renderRichContent` is triggered via a 50 ms debounce (`renderDebounceMs = 50`) and re-processes the entire rendered DOM including highlight.js and KaTeX on each call. For large files with many code blocks or math expressions this causes visible jank during editing in split-view or live mode.
- Files: `src/lib/MarkdownViewer.svelte` (lines 58-59, 714)
- Cause: No dirty-check to skip unchanged sections; the entire DOM is replaced.
- Improvement path: Increase debounce for large files, or implement partial re-render by diff-patching only changed sections.

**`processMarkdownHtml` parses the whole DOM on every render:**
- Problem: `processMarkdownHtml` in `src/lib/utils/markdown.ts` builds a full `DOMParser` tree (line 477), traverses it multiple times for callouts, math, task items, block IDs, highlights, and headings, then serialises back to `innerHTML`. For documents with hundreds of headings or task items this is O(n) per render cycle.
- Files: `src/lib/utils/markdown.ts` (line 471)
- Cause: No caching; repeated invocations (tab switch, content reload) redo all work.
- Improvement path: Cache the processed result keyed by content hash; skip reprocessing if content has not changed.

**Mermaid `initialize()` called on every `renderRichContent` invocation:**
- Problem: `mermaid.initialize(...)` is called inside `renderRichContent` in both `src/lib/MarkdownViewer.svelte` (line 591) and `src/lib/utils/markdown.ts` (line 753) on every render. Mermaid initialization is expensive.
- Files: `src/lib/MarkdownViewer.svelte` (line 591), `src/lib/utils/markdown.ts` (line 753)
- Improvement path: Track whether the theme has changed and call `initialize` only when theme or first-load.

---

## Fragile Areas

**Tab state serialised to `localStorage` as raw JSON:**
- Files: `src/lib/stores/tabs.svelte.ts` (lines 48-66), `src/lib/MarkdownViewer.svelte` (lines 1666, 2267, 2439)
- Why fragile: Tab state is serialised with `JSON.stringify` and deserialised with `JSON.parse` without schema validation. Adding, removing, or renaming a field on the `Tab` interface silently produces partial or missing state when reading back old data. `editorViewState` is explicitly nulled out on save but the code relies on this behaviour remaining consistent.
- Safe modification: Add a version field to the serialised blob and migrate on load. Validate all expected fields after `JSON.parse`.
- Test coverage: Zero — no unit tests exist for serialisation/deserialisation.

**File watcher race with self-write suppression:**
- Files: `src/lib/MarkdownViewer.svelte` (lines 125-127, 1445, 1451, 1482, 2306)
- Why fragile: A `selfWriteUntilByPath` map suppresses file-watcher reloads for 400 ms after a save. If a save takes longer than 400 ms (slow filesystem, network share) the suppression window expires before the watcher fires, causing an unexpected reload. Conversely, if an external edit happens within 400 ms of a save, it is silently discarded.
- Safe modification: Use an event counter or content-hash comparison rather than a fixed grace period.

**Atomic write does not apply to image saves or theme saves:**
- Files: `src-tauri/src/lib.rs` (lines 401, 528, 737)
- Why fragile: `save_theme` (line 401), `fetch_vscode_theme` (line 528), and `save_image` (line 737) all call `fs::write` directly rather than the `atomic_write` helper. A crash during any of these writes will corrupt the target file.
- Safe modification: Route all file writes through `atomic_write`.

**`unwrap()` on Mutex locks can panic if a thread poisoned the lock:**
- Files: `src-tauri/src/lib.rs` (lines 343, 371, 387, 1056, 1077, 1165)
- Why fragile: `state.watcher.lock().unwrap()` panics if any earlier thread panicked while holding the lock. In the Tauri single-instance plugin callback (line 882) `expect("no main window")` panics if the window has already been destroyed.
- Safe modification: Replace `unwrap()` with `map_err(...)?` or `unwrap_or_else` with graceful degradation for Mutex accesses. Handle the absent-window case with `if let Some(window) = ...`.

**`env::var("USERPROFILE").unwrap()` in Windows uninstaller:**
- Files: `src-tauri/src/setup.rs` (lines 207, 219, 346, 352)
- Why fragile: These `unwrap()` calls panic if `USERPROFILE` or `APPDATA` are not set — which can happen in service contexts, locked-down enterprise environments, or when the uninstaller is launched by a different user.
- Safe modification: Replace with `unwrap_or_else` supplying a fallback path, matching the pattern already used for `PUBLIC` and `ProgramData`.

---

## Known Bugs

**`processTaskItems` divergence between editor and preview paths:**
- Symptoms: Task checkboxes in documents with complex nesting (e.g., a paragraph immediately after the checkbox inside an `<li>`) render differently when loaded via the Rust `open_markdown` path vs. the preview path that calls `processMarkdownHtml`. The MarkdownViewer inline version (line 434) uses a simpler loop that does not handle `P`-wrapped checkbox text, while markdown.ts uses the full `isTaskCheckbox` / `paragraphNode` logic.
- Files: `src/lib/MarkdownViewer.svelte` (line 434), `src/lib/utils/markdown.ts` (line 394)
- Trigger: Open a file containing `- [x] **bold** text` or a task item followed by a paragraph.
- Workaround: Switch tabs or toggle edit mode to force re-render through the canonical path.

**`DEBUG_MACOS` flag left in TitleBar.svelte:**
- Symptoms: `const DEBUG_MACOS = false` at `src/lib/components/TitleBar.svelte` (line 100). The flag is referenced in `isMac` and `useNativeMacChrome` conditionals. Setting it to `true` bypasses the OS detection, intended only for development. If accidentally shipped as `true`, all platforms would display the macOS traffic-light window chrome.
- Files: `src/lib/components/TitleBar.svelte` (lines 100-103)
- Trigger: Manually setting `DEBUG_MACOS = true`.
- Workaround: Keep value at `false`; remove the flag entirely and replace with a proper dev-mode guard.

---

## Test Coverage Gaps

**No automated tests exist:**
- What's not tested: The entire codebase — both frontend (Svelte/TypeScript) and backend (Rust) — has zero automated tests. No test files were found; no test runner is configured in `package.json` (no `vitest`, `jest`, or `playwright` entries); no `#[test]` functions exist in the Rust source.
- Files: All of `src/`, `src-tauri/src/`
- Risk: Regressions in core functionality (markdown rendering, file save/load, tab state, clipboard paste, regex-based wikilink processing) go undetected until manual QA. The recent fix for find-in-CODE/PRE areas (commit `510325c`) is a concrete example of a bug that could have been caught by a regression test.
- Priority: High

**`processMarkdownHtml` regex and DOM logic is entirely untested:**
- What's not tested: All regex substitution logic in `process_wikilinks`, `process_internal_embeds` (Rust), and `processMarkdownHtml` (TypeScript), including highlight syntax, footnote numbering, callout parsing, header folding IDs, and math delimiter conversion.
- Files: `src-tauri/src/lib.rs` (lines 127-264), `src/lib/utils/markdown.ts` (lines 93-731)
- Risk: Edge-case inputs (nested code blocks, malformed wikilinks, adjacent `$$` delimiters) produce silent incorrect output with no signal to the developer.
- Priority: High

**`atomic_write` Rust function is untested:**
- What's not tested: The symlink-follow path, permission restoration, the parent-directory fsync on Unix, and the TOCTOU race between `symlink_metadata` and `canonicalize`.
- Files: `src-tauri/src/lib.rs` (lines 28-114)
- Risk: Data loss on crash or filesystem-edge conditions.
- Priority: Medium

---

## Dependencies at Risk

**`tauri-plugin-prevent-default = "2.0.0-rc.1"` (release candidate):**
- Risk: The RC designation means the API is unstable and may change or be yanked without a semver-breaking version bump. This is the only pre-release crate in the dependency tree.
- Files: `src-tauri/Cargo.toml` (line 33)
- Impact: Future `cargo update` may fail or silently break default-action suppression (e.g., browser context menus, drag-and-drop defaults inside the WebView).
- Migration plan: Monitor the crate for a stable `2.x` release and update the version constraint accordingly.

**`comrak = "0.18"` is pinned to a specific minor version:**
- Risk: comrak's security patch releases will not be applied automatically since there is no `>=` or `^` constraint. Any XSS fix or parser correctness fix in a `0.18.x` patch would require a manual `Cargo.toml` edit.
- Files: `src-tauri/Cargo.toml` (line 31)
- Migration plan: Change to `comrak = "^0.18"` to receive patch updates automatically.

---

*Concerns audit: 2026-05-20*
