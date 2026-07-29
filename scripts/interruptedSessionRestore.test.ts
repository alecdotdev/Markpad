import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const session = readFileSync('src/lib/sessions/windowSession.svelte.ts', 'utf8');

test('session restore records work in progress before restoring tabs', () => {
	assert.match(viewer, /const RESTORE_IN_PROGRESS_KEY = 'markpad-window-restore-in-progress';/);
	assert.match(session, /localStorage\.setItem\(options\.restoreInProgressKey, 'true'\);/);
	assert.match(session, /finally \{\s*localStorage\.removeItem\(options\.restoreInProgressKey\);/s);
});

test('an interrupted restore discards saved tabs without deleting documents', () => {
	assert.match(session, /if \(localStorage\.getItem\(options\.restoreInProgressKey\)\)/);
	assert.match(session, /await discardPersistedState\(\);/);
	assert.match(viewer, /await windowSession\.discardPersistedState\(\);/);
	assert.match(session, /localStorage\.removeItem\(options\.windowStateKey\);/);
	assert.match(session, /localStorage\.removeItem\(options\.legacyStateKey\);/);
	assert.match(session, /await invoke\('clear_window_state'\);/);
});
