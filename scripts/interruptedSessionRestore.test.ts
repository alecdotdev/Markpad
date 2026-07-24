import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

test('session restore records work in progress before restoring tabs', () => {
	assert.match(viewer, /const RESTORE_IN_PROGRESS_KEY = 'markpad-window-restore-in-progress';/);
	assert.match(viewer, /localStorage\.setItem\(RESTORE_IN_PROGRESS_KEY, 'true'\);/);
	assert.match(viewer, /finally \{\s*localStorage\.removeItem\(RESTORE_IN_PROGRESS_KEY\);/s);
});

test('an interrupted restore discards saved tabs without deleting documents', () => {
	assert.match(viewer, /if \(localStorage\.getItem\(RESTORE_IN_PROGRESS_KEY\)\)/);
	assert.match(viewer, /await discardPersistedWindowState\(\);/);
	assert.match(viewer, /async function discardPersistedWindowState\(\) \{\s*localStorage\.removeItem\(WINDOW_STATE_KEY\);\s*localStorage\.removeItem\(LEGACY_STATE_KEY\);/s);
	assert.match(viewer, /await invoke\('clear_window_state'\);/);
});
