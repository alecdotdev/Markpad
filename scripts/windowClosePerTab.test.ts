import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { offsetOf, sliceBetween, sliceFrom } from './sourceTree.js';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const documentSessionPath = 'src/lib/sessions/documentSession.svelte.ts';
const documentSession = existsSync(documentSessionPath) ? readFileSync(documentSessionPath, 'utf8') : '';

// Window close (issue #189): instead of one aggregate "you have N unsaved
// files" modal, the red close button walks the dirty tabs one at a time —
// activating each and showing the SAME localized unsaved-changes dialog a
// single tab close shows (canCloseTab). Cancel stops the walk; the window
// stays open with the remaining tabs.

function closeHandler(): string {
	return sliceBetween(viewer, 'appWindow.onCloseRequested', 'onDragDropEvent');
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
	const branchStart = offsetOf(handler, 'if (dirtyTabs.length > 0) {');
	const prevent = offsetOf(handler, 'event.preventDefault()', branchStart);
	const walk = offsetOf(handler, 'canCloseTab(dirty.id)', branchStart);
	assert.ok(prevent < walk, 'the close is prevented before the walk starts');
});

test('the window closes only after every dirty tab is resolved', () => {
	const handler = closeHandler();
	const walk = offsetOf(handler, 'canCloseTab(dirty.id)');
	const close = offsetOf(handler, 'appWindow.close()', walk);
	assert.ok(walk < close, 'the window closes after the walk, not during it');
});

test('a second close request cannot start a competing walk', () => {
	const handler = closeHandler();
	// The native red button bypasses the dialog overlay; re-entry must be
	// swallowed while a walk is active, or two walks fight over setActive
	// and the highlighted tab stops matching the dialog.
	assert.match(handler, /if \(isCloseWalkActive\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/);
	// and the flag is always released, even when the user cancels mid-walk
	assert.match(handler, /finally \{\s*isCloseWalkActive = false;\s*\}/);
});

test('the walk proceeds in strict tab-strip order', () => {
	const handler = closeHandler();
	// Predictable left-to-right order: always the first dirty tab in the
	// array; no active-first shortcut that made the sequence look random.
	assert.match(handler, /const dirty = tabManager\.tabs\.find\(\(t\) => t\.isDirty\);/);
	assert.doesNotMatch(handler, /active\?\.isDirty/);
});

test('the untitled save dialog prefills the numbered tab title', () => {
	const scope = sliceBetween(documentSession, 'async function saveContent', 'async function saveContentAs');
	assert.match(scope, /defaultPath: tab\.title/);
});

test('save-as keeps snapshot-based dirty tracking in documentSession', () => {
	const fn = sliceFrom(documentSession, 'async function saveContentAs');
	assert.match(fn, /const snapshot = tab\.rawContent;/);
	assert.match(fn, /tab\.isDirty = tab\.rawContent !== snapshot;/);
});

test('the restore-on-reopen branch persists window state via the shared helper', () => {
	const handler = closeHandler();
	assert.match(handler, /persistWindowState\(\);/);
	// no durable-write experiment left behind
	assert.doesNotMatch(viewer, /saveSessionState|sessionState\.js/);
});
