import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tabs = readFileSync('src/lib/stores/tabs.svelte.ts', 'utf8');
const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

// Session restore persists WINDOW state only: which files are open, the
// active tab, and per-tab UI (edit mode, split, scroll). Document content
// always lives on disk — the snapshot never carries rawContent, so unsaved
// changes are handled exclusively by the per-tab close dialogs.

function slice(source: string, from: string, to: string): string {
	const start = source.indexOf(from);
	assert.ok(start !== -1, `${from} not found`);
	const end = source.indexOf(to, start);
	assert.ok(end !== -1, `${to} not found after ${from}`);
	return source.slice(start, end);
}

test('serializeState writes window state only', () => {
	const fn = slice(tabs, 'serializeState()', 'restoreState(');
	assert.match(fn, /version: 2/);
	// untitled tabs have no disk backing; they are resolved at close, never persisted
	assert.match(fn, /filter\(\(t\) => t\.path !== ''\)/);
	// no full-object spread and no content fields in the snapshot
	assert.doesNotMatch(fn, /\.\.\.t/);
	assert.doesNotMatch(fn, /rawContent/);
	assert.doesNotMatch(fn, /originalContent/);
	assert.doesNotMatch(fn, /isDirty/);
	assert.doesNotMatch(fn, /history/);
});

test('restoreState rebuilds clean tabs and drops legacy untitled entries', () => {
	const fn = slice(tabs, 'restoreState(', 'addTab(');
	// path is the identity of a restored tab; entries without one are skipped
	assert.match(fn, /saved\.path === ''\) continue;/);
	// restored tabs start clean; content is read from disk afterwards
	assert.match(fn, /isDirty: false/);
	assert.match(fn, /rawContent: ''/);
	// a stale activeTabId falls back to the first restored tab
	assert.match(fn, /activeTabId/);
});

test('startup restore reads content from disk, not from the snapshot', () => {
	const init = slice(viewer, 'localStorage.getItem(WINDOW_STATE_KEY)', 'urlParams');
	assert.match(init, /read_file_content/);
	// a missing file drops its tab instead of restoring a ghost
	assert.match(init, /closeTab\(/);
});

test('the discard choice reverts the tab to its last saved content', () => {
	const fn = slice(viewer, 'async function canCloseTab', 'async function toggleEdit');
	assert.match(fn, /tab\.rawContent = tab\.originalContent;/);
	assert.match(fn, /tab\.isDirty = false;/);
});

test('the close flow resolves dirty tabs before serializing window state', () => {
	const handlerStart = viewer.indexOf('appWindow.onCloseRequested');
	const handler = viewer.slice(handlerStart, viewer.indexOf('onDragDropEvent', handlerStart));
	const walk = handler.indexOf('canCloseTab(dirty.id)');
	const persist = handler.indexOf('persistWindowState()');
	assert.ok(walk !== -1, 'per-tab walk not found');
	assert.ok(persist !== -1, 'window-state serialization not found');
	assert.ok(walk < persist, 'dirty tabs must be resolved before the snapshot is written');
});

test('v2 snapshots live under their own key, invisible to legacy builds', () => {
	// An older build restoring a v2 snapshot ends up with undefined tab
	// content; its editor then attributes a stale buffer to the wrong tab and
	// auto-save writes it to disk. Separate keys keep the formats apart.
	const helper = viewer.slice(viewer.indexOf('function persistWindowState'));
	const scope = helper.slice(0, helper.indexOf('\n\t}'));
	assert.match(scope, /setItem\(WINDOW_STATE_KEY/);
	assert.match(scope, /removeItem\(LEGACY_STATE_KEY\)/);
	assert.match(viewer, /const WINDOW_STATE_KEY = 'savedTabsDataV2';/);
	// startup prefers the v2 key and falls back to legacy for migration
	assert.match(
		viewer,
		/localStorage\.getItem\(WINDOW_STATE_KEY\) \?\? localStorage\.getItem\(LEGACY_STATE_KEY\)/,
	);
	// explicit exit clears both
	const exitFn = viewer.slice(viewer.indexOf('async function appExit'));
	const exitScope = exitFn.slice(0, exitFn.indexOf('\n\t}'));
	assert.match(exitScope, /removeItem\(WINDOW_STATE_KEY\)/);
	assert.match(exitScope, /removeItem\(LEGACY_STATE_KEY\)/);
});

test('with restore enabled resolved titled tabs stay open for the snapshot', () => {
	const handlerStart = viewer.indexOf('appWindow.onCloseRequested');
	const handler = viewer.slice(handlerStart, viewer.indexOf('onDragDropEvent', handlerStart));
	// tabs are closed one-by-one only when restore is off (or untitled)
	assert.match(handler, /restoreStateOnReopen \|\| dirty\.path === ''/);
});

test('auto-save fast path silently saves titled tabs before the walk', () => {
	const handlerStart = viewer.indexOf('appWindow.onCloseRequested');
	const handler = viewer.slice(handlerStart, viewer.indexOf('onDragDropEvent', handlerStart));
	const fastPath = handler.indexOf('settings.autoSave && !settings.confirmBeforeSave');
	const walk = handler.indexOf('canCloseTab(dirty.id)');
	assert.ok(fastPath !== -1 && walk !== -1 && fastPath < walk);
});
