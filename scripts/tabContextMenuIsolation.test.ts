import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contextMenu = readFileSync(new URL('../src/lib/components/ContextMenu.svelte', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');
const tab = readFileSync(new URL('../src/lib/components/Tab.svelte', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

// Issue #356, first failure: right-clicking a second time while a tab menu is
// open produced a *different* menu. The open menu's overlay covers the whole
// viewport, so the second right-click lands on the overlay — which dismissed
// the tab menu but let the event keep bubbling to the document-level handler,
// which then opened the document context menu (Copy / Select All / Edit).
test('the context-menu overlay does not leak right-clicks to the document handler', () => {
	assert.match(
		contextMenu,
		/class="context-menu-overlay"[^>]*oncontextmenu=\{\(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); onhide\(\); \}\}/,
	);
});

test('the document context menu is still reachable when no menu overlay is open', () => {
	// Guard against "fixing" the leak by disabling the document menu outright.
	assert.match(viewer, /oncontextmenu=\{handleContextMenu\}/);
	assert.match(viewer, /function handleContextMenu\(e: MouseEvent\) \{/);
});

test('a tab right-click never reaches the tab-strip container menu', () => {
	// Tab.svelte stops propagation itself; that is the other half of keeping
	// exactly one menu per right-click.
	assert.match(
		tab,
		/async function handleContextMenu\(e: MouseEvent\) \{\n\t\te\.preventDefault\(\);\n\t\te\.stopPropagation\(\);/,
	);
});

// Issue #356, second failure: "Move to New Window" did nothing on Windows and
// then froze the whole app (no menus, dead close button, force-kill required).
// `WebviewWindowBuilder::build()` deadlocks when called from a synchronous
// Tauri command on Windows/WebView2 — the main thread is blocked inside the
// command while WebView2 waits for that same thread to pump messages.
// See tauri-apps/tauri#12521.
test('create_transfer_window is async so window creation cannot deadlock the main thread', () => {
	assert.match(lib, /#\[tauri::command\]\nasync fn create_transfer_window\(/);
	assert.doesNotMatch(lib, /#\[tauri::command\]\nfn create_transfer_window\(/);
});
