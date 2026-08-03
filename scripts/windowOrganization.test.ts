import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync('src-tauri/src/window_runtime.rs', 'utf8');
const session = readFileSync('src/lib/sessions/windowSession.svelte.ts', 'utf8');
const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const tab = readFileSync('src/lib/components/Tab.svelte', 'utf8');
const titleBar = readFileSync('src/lib/components/TitleBar.svelte', 'utf8');

test('the runtime registers live viewer windows in stable creation order', () => {
	assert.match(runtime, /window_registry/);
	assert.match(runtime, /window_counter/);
	assert.match(runtime, /pub fn set_window_meta/);
	assert.match(runtime, /pub fn list_viewer_windows/);
	assert.match(runtime, /list\.sort_by_key\(\|entry\| entry\.meta\.number\)/);
	assert.match(runtime, /window_registry[\s\S]*?remove\(window\.label\(\)\)/);
});

test('moving to an existing window uses the acknowledged transfer protocol', () => {
	assert.match(session, /async function transfer\(/);
	assert.match(session, /invoke\('complete_detached_tab', \{ token \}\)/);
	assert.match(session, /onTransferClaimed\(tabId\)/);
	assert.match(session, /async function acceptOfferedTransfer/);
	assert.match(viewer, /invoke\('offer_tab_to_window', \{ targetLabel, token \}\)/);
});

// Salvaged from `tabContextMenuIsolation.test.ts`, which was deleted for pinning
// the exact text of two inline Svelte event handlers. This assertion is not
// about spelling: `WebviewWindowBuilder::build()` deadlocks when called from a
// *synchronous* Tauri command on Windows/WebView2, because the main thread is
// blocked inside the command while WebView2 waits for that same thread to pump
// messages (tauri-apps/tauri#12521). Both forms compile everywhere, and CI's
// `cargo test` runs on a host where the deadlock cannot happen, so dropping the
// `async` is invisible until "Move to New Window" freezes a Windows user's app
// hard enough to need a force-kill. Issue #356.
test('create_transfer_window is async so window creation cannot deadlock the main thread', () => {
	const lib = readFileSync('src-tauri/src/lib.rs', 'utf8');

	assert.match(lib, /#\[tauri::command\]\nasync fn create_transfer_window\(/);
	assert.doesNotMatch(lib, /#\[tauri::command\]\nfn create_transfer_window\(/);
});

test('window organization exposes move, merge, and carry actions', () => {
	assert.match(tab, /list_viewer_windows/);
	assert.match(tab, /menu-tab-move/);
	assert.match(viewer, /async function mergeAllWindowsHere/);
	assert.match(viewer, /async function carryActiveTabToNextWindow/);
	assert.match(viewer, /cmdOrCtrl && e\.shiftKey && key === 'm'/);
	assert.match(titleBar, /onmergeAllWindows/);
});
