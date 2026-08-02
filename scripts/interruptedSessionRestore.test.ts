import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The wiring behind the behaviour that `sessionRestoreResilience.test.ts`
// exercises: the breadcrumb key exists, it is written before the work and
// settled afterwards no matter how the pass ends, and an interrupted pass is
// never answered by deleting the snapshot.

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const session = readFileSync('src/lib/sessions/windowSession.svelte.ts', 'utf8');

test('session restore records work in progress before restoring tabs', () => {
	assert.match(viewer, /const RESTORE_IN_PROGRESS_KEY = 'markpad-window-restore-in-progress';/);
	assert.match(
		session,
		/const progress: RestoreProgress = \{ running: true, pending: null, deferred, interruptions \};\s*\n\s*writeProgress\(progress\);/,
	);
	// The record names the document being read, not just "a restore is running":
	// that is what lets the next launch skip one document instead of all of them.
	assert.match(session, /progress\.pending = tab\.path;\s*\n\s*writeProgress\(progress\);/);
	assert.match(session, /finally \{\s*writeProgress\(\{ running: false,/s);
});

test('an interrupted restore keeps the snapshot instead of deleting it', () => {
	const restore = session.slice(session.indexOf('async function restore'), session.indexOf('async function claimTransferredTab'));
	assert.match(restore, /if \(previous\?\.running\)/);
	// Deleting the whole snapshot is what made one document cost the user every
	// tab they had open. Nothing in restore() may discard it.
	assert.doesNotMatch(restore, /discardPersistedState/);
	assert.doesNotMatch(restore, /clear_window_state/);
	// Explicit exit is a different matter: the user chose it.
	assert.match(session, /async function discardPersistedState/);
	assert.match(session, /await invoke\('clear_window_state'\);/);
	assert.match(viewer, /await windowSession\.discardPersistedState\(\);/);
});
