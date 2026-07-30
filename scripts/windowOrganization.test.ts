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

test('window organization exposes move, merge, and carry actions', () => {
	assert.match(tab, /list_viewer_windows/);
	assert.match(tab, /menu-tab-move/);
	assert.match(viewer, /async function mergeAllWindowsHere/);
	assert.match(viewer, /async function carryActiveTabToNextWindow/);
	assert.match(viewer, /cmdOrCtrl && e\.shiftKey && key === 'm'/);
	assert.match(titleBar, /onmergeAllWindows/);
});
