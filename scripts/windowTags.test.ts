import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tabs = readFileSync('src/lib/stores/tabs.svelte.ts', 'utf8');
const runtime = readFileSync('src-tauri/src/window_runtime.rs', 'utf8');
const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const titleBar = readFileSync('src/lib/components/TitleBar.svelte', 'utf8');
const home = readFileSync('src/lib/components/HomePage.svelte', 'utf8');

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
	const exportIndex = titleBar.indexOf("t('menu.exportPdf', currentLanguage)");
	const tagIndex = titleBar.indexOf("t('menu.setWindowTag', currentLanguage)");
	const mergeIndex = titleBar.indexOf("t('menu.mergeAllWindows', currentLanguage)");
	const exitIndex = titleBar.indexOf("t('menu.exit', currentLanguage)");

	assert.ok(exportIndex < tagIndex);
	assert.ok(tagIndex < mergeIndex);
	assert.ok(mergeIndex < exitIndex);
	assert.match(titleBar, /homeMenuOpen = false;\s*openTagEditor\(\);/);
});
