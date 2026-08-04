import assert from 'node:assert/strict';
import test from 'node:test';

import { offsetOf, readSource } from './sourceTree.js';

const tabs = readSource('src/lib/stores/tabs.svelte.ts');
const runtime = readSource('src-tauri/src/window_runtime.rs');
const viewer = readSource('src/lib/MarkdownViewer.svelte');
const titleBar = readSource('src/lib/components/TitleBar.svelte');
const home = readSource('src/lib/components/HomePage.svelte');

test('window tags persist with the v2 window snapshot', () => {
	assert.match(tabs, /windowTag = \$state/);
	assert.match(tabs, /windowTag: this\.windowTag/);
	assert.match(tabs, /data\.windowTag\.pinned === true/);
});

test('only explicitly pinned tags create reusable sessions', () => {
	assert.match(runtime, /pub fn save_pinned_tag/);
	assert.match(runtime, /pub fn remove_pinned_tag/);
	assert.match(viewer, /if \(!tag\?\.pinned\) return;/);
	assert.match(viewer, /savePinnedTagIfNeeded/);
	assert.match(home, /onopenPinnedTag/);
});

test('the title bar exposes a named color chip and pin control', () => {
	assert.match(titleBar, /tagColors/);
	assert.match(titleBar, /window-tag-chip/);
	assert.match(titleBar, /togglePinnedTag/);
});

test('the Home menu groups window organization below export actions', () => {
	const exportIndex = offsetOf(titleBar, "t('menu.exportPdf', currentLanguage)");
	const tagIndex = offsetOf(titleBar, "t('menu.setWindowTag', currentLanguage)");
	const mergeIndex = offsetOf(titleBar, "t('menu.mergeAllWindows', currentLanguage)");
	const exitIndex = offsetOf(titleBar, "t('menu.exit', currentLanguage)");

	assert.ok(exportIndex < tagIndex);
	assert.ok(tagIndex < mergeIndex);
	assert.ok(mergeIndex < exitIndex);
	assert.match(titleBar, /homeMenuOpen = false;\s*openTagEditor\(\);/);
});
