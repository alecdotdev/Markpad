import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

// Window close (issue #189): instead of one aggregate "you have N unsaved
// files" modal, the red close button walks the dirty tabs one at a time —
// activating each and showing the SAME localized unsaved-changes dialog a
// single tab close shows (canCloseTab). Cancel stops the walk; the window
// stays open with the remaining tabs.

function closeHandler(): string {
	const start = viewer.indexOf('appWindow.onCloseRequested');
	assert.ok(start !== -1, 'close handler registration not found');
	return viewer.slice(start, viewer.indexOf('onDragDropEvent', start));
}

test('the aggregate unsaved-files modal is gone from the close handler', () => {
	const handler = closeHandler();
	assert.doesNotMatch(handler, /youHaveUnsavedFiles/);
	// and the old "clear all dirty flags then close" discard path with it
	assert.doesNotMatch(handler, /tabManager\.tabs\.forEach\(\(t\) => \(t\.isDirty = false\)\)/);
});

test('dirty tabs are reviewed one at a time through the existing canCloseTab flow', () => {
	const handler = closeHandler();
	// activate the tab under review so the user sees what the dialog is about
	assert.match(handler, /tabManager\.setActive\(dirty\.id\);/);
	// the existing localized per-tab dialog decides save / discard / cancel
	assert.match(handler, /await canCloseTab\(dirty\.id\)/);
	// a resolved tab actually closes before moving on
	assert.match(handler, /tabManager\.closeTab\(dirty\.id\);/);
});

test('cancelling the per-tab dialog stops the walk and keeps the window open', () => {
	const handler = closeHandler();
	assert.match(handler, /if \(!\(await canCloseTab\(dirty\.id\)\)\) return;/);
});

test('the close is prevented synchronously before the per-tab walk', () => {
	const handler = closeHandler();
	const branchStart = handler.indexOf('if (dirtyTabs.length > 0) {');
	assert.ok(branchStart !== -1, 'dirty branch not found');
	const prevent = handler.indexOf('event.preventDefault()', branchStart);
	const walk = handler.indexOf('canCloseTab(dirty.id)', branchStart);
	assert.ok(prevent !== -1 && walk !== -1 && prevent < walk);
});

test('the window closes only after every dirty tab is resolved', () => {
	const handler = closeHandler();
	const walk = handler.indexOf('canCloseTab(dirty.id)');
	const close = handler.indexOf('appWindow.close()', walk);
	assert.ok(walk !== -1 && close !== -1 && walk < close);
});

test('the restore-on-reopen branch is untouched original behavior', () => {
	const handler = closeHandler();
	assert.match(handler, /localStorage\.setItem\('savedTabsData', stateStr\);/);
	// no durable-write experiment left behind
	assert.doesNotMatch(viewer, /saveSessionState|sessionState\.js/);
});
