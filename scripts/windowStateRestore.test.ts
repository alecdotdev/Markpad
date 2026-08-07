import assert from 'node:assert/strict';
import test from 'node:test';

import { offsetOf, readSource, sliceBetween } from './sourceTree.js';

const tabs = readSource('src/lib/stores/tabs.svelte.ts');
const viewer = readSource('src/lib/MarkdownViewer.svelte');
const session = readSource('src/lib/sessions/windowSession.svelte.ts');
const documentSession = readSource('src/lib/sessions/documentSession.svelte.ts');

// Session restore persists WINDOW state only: which files are open, the
// active tab, and per-tab UI (edit mode, split, scroll). Document content
// always lives on disk — the snapshot never carries rawContent, so unsaved
// changes are handled exclusively by the per-tab close dialogs.

/** The `onCloseRequested` registration, up to the next window listener. */
function closeHandler(): string {
	return sliceBetween(viewer, 'appWindow.onCloseRequested', 'onDragDropEvent');
}

test('serializeState writes window state only', () => {
	const fn = sliceBetween(tabs, 'serializeState()', 'restoreState(');
	assert.match(fn, /version: 2/);
	// untitled tabs have no disk backing; they are resolved at close, never
	// persisted — and neither is the home tab, whose path is the sentinel
	// string 'HOME' rather than a file (homeSentinelSnapshot.test.ts)
	assert.match(fn, /filter\(\(t\) => hasRealFilePath\(t\.path\)\)/);
	// no full-object spread and no content fields in the snapshot
	assert.doesNotMatch(fn, /\.\.\.t/);
	assert.doesNotMatch(fn, /rawContent/);
	assert.doesNotMatch(fn, /originalContent/);
	assert.doesNotMatch(fn, /isDirty/);
	assert.doesNotMatch(fn, /history/);
});

test('restoreState rebuilds clean tabs and drops legacy untitled entries', () => {
	const fn = sliceBetween(tabs, 'restoreState(', 'addTab(');
	// path is the identity of a restored tab; entries without a real file path
	// are skipped, including 'HOME' entries left by older builds
	assert.match(fn, /!hasRealFilePath\(saved\.path\)\) continue;/);
	// restored tabs start clean; content is read from disk afterwards
	assert.match(fn, /isDirty: false/);
	assert.match(fn, /rawContent: ''/);
	// a stale activeTabId falls back to the first restored tab
	assert.match(fn, /activeTabId/);
});

test('startup restore reads content from disk, not from the snapshot', () => {
	const restore = sliceBetween(session, 'async function restore', 'async function claimTransferredTab');
	assert.match(restore, /read_file_content/);
	// a file that cannot be read keeps its tab and its place in the snapshot —
	// dropping it here also dropped it from the snapshot written moments later
	// (sessionRestoreResilience.test.ts)
	assert.match(restore, /tabManager\.markTabContentUnavailable\(tab\.id\);/);
	// dropping is reserved for an entry that is not a file at all — a legacy
	// 'HOME' sentinel (homeSentinelSnapshot.test.ts)
	assert.match(restore, /if \(!hasRealFilePath\(tab\.path\)\) \{\s*\n\s*options\.dropRestoredTab\(tab\.id\);/);
	assert.match(viewer, /await windowSession\.restore\(\);/);
});

test('the discard choice reverts the tab to its last saved content', () => {
	const fn = sliceBetween(documentSession, 'async function canCloseTab', 'return { loadMarkdown');
	assert.match(fn, /tab\.rawContent = tab\.originalContent;/);
	assert.match(fn, /tab\.isDirty = false;/);
});

test('the close flow resolves dirty tabs before serializing window state', () => {
	const handler = closeHandler();
	const walk = offsetOf(handler, 'canCloseTab(dirty.id)');
	const persist = offsetOf(handler, 'persistWindowState()');
	assert.ok(walk < persist, 'dirty tabs must be resolved before the snapshot is written');
});

test('v2 snapshots are invisible to legacy builds (Rust file, localStorage keys removed)', () => {
	// An older build restoring a snapshot it cannot understand ends up with
	// undefined tab content; its editor then attributes a stale buffer to the
	// wrong tab and auto-save writes it to disk. The snapshot now lives in a
	// Rust-written file (setItem is an async message to the WebKit storage
	// process and loses a flush race when the last window's close ends the
	// process); both localStorage keys are removed on write, so a downgraded
	// build starts a fresh session instead of misreading anything.
	const scope = sliceBetween(session, 'async function persistState', 'async function restore');
	assert.match(scope, /invoke\('save_window_state'/);
	assert.doesNotMatch(scope, /setItem\(/);
	assert.match(scope, /removeItem\(options\.windowStateKey\)/);
	assert.match(scope, /removeItem\(options\.legacyStateKey\)/);
	assert.match(viewer, /const WINDOW_STATE_KEY = 'savedTabsDataV2';/);
	// only the main window persists: secondary labels are per-session, and a
	// shared write slot would let the last window closed overwrite the rest
	assert.match(scope, /if \(!options\.isMainWindow\) return;/);
	// startup prefers the Rust file and falls back to the localStorage keys
	// (v2 first, then legacy) for one-time migration of older snapshots
	assert.match(session, /invoke\('load_window_state'\)/);
	assert.match(
		session,
		/localStorage\.getItem\(options\.windowStateKey\) \?\?\n?\s*localStorage\.getItem\(options\.legacyStateKey\)/,
	);
	// The shared helper clears the Rust snapshot and both localStorage keys.
	// Only explicit exit uses it: a restore that goes wrong must never delete
	// the record of which documents were open (interruptedSessionRestore.test.ts).
	const discardScope = sliceBetween(session, 'async function discardPersistedState', 'async function readProgress');
	assert.match(discardScope, /clear_window_state/);
	assert.match(discardScope, /removeItem\(options\.windowStateKey\)/);
	assert.match(discardScope, /removeItem\(options\.legacyStateKey\)/);
	// Explicit exit delegates to the same cleanup path.
	const exitScope = sliceBetween(viewer, 'async function appExit', '\n\t}');
	assert.match(exitScope, /await discardPersistedWindowState\(\)/);
});

test('exit discards the snapshot only once startup has finished', () => {
	const exitScope = sliceBetween(viewer, 'async function appExit', '\n\t}');
	// Until `init` flips `mode` to 'app', the file on disk is the only complete
	// record of the session: restore has rebuilt the tab list but is still
	// reading those files back. An unreachable restored path stretches that
	// window to one share timeout per tab, and the loading screen renders the
	// ☰ menu while every keyboard shortcut is inert — so Exit is the control
	// the user reaches for, and discarding there costs them the session.
	assert.match(exitScope, /restoreStateOnReopen && mode === 'app'/);
	const gate = offsetOf(exitScope, "mode === 'app'");
	const discard = offsetOf(exitScope, 'discardPersistedWindowState()');
	assert.ok(gate < discard, 'the discard must sit behind the startup gate');
});

test('with restore enabled resolved titled tabs stay open for the snapshot', () => {
	const handler = closeHandler();
	// tabs are closed one-by-one only when restore is off (or untitled)
	assert.match(handler, /restoreStateOnReopen \|\| dirty\.path === ''/);
});

test('auto-save fast path silently saves titled tabs before the walk', () => {
	const handler = closeHandler();
	const fastPath = offsetOf(handler, 'if (settings.autoSave) {');
	const walk = offsetOf(handler, 'canCloseTab(dirty.id)');
	assert.ok(fastPath < walk, 'the silent save runs before the per-tab walk');
});
