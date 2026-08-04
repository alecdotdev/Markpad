import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { callbackBodies, filesMatching, readSourceFiles, sliceBetween } from './sourceTree.js';

const runtime = readFileSync('src-tauri/src/window_runtime.rs', 'utf8');
const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

test('Live Mode routes a watcher notification to its watched path', () => {
	assert.match(runtime, /emit_to\(event_label\.as_str\(\), "file-changed", watched_path\.clone\(\)\)/);
	assert.match(viewer, /await appWindow\.listen\('file-changed', \(event\) => \{/);
	assert.match(viewer, /const changedPath = event\.payload as string;/);
	// The listener no longer compares the payload with the active file itself:
	// resolveExternalChange looks up the tab that OWNS the changed path (and
	// refuses to reload it when it has unsaved edits). See
	// externalChangeReload.test.ts for the routing behaviour.
	assert.match(viewer, /if \(!liveMode\) return;/);
	assert.match(viewer, /documentSession\.resolveExternalChange\(changedPath\)/);
	const session = readFileSync('src/lib/sessions/documentSession.svelte.ts', 'utf8');
	assert.match(session, /tabManager\.tabs\.find\(\(tab\) => tab\.path === changedPath\)/);
});

test('Live Mode follows the active file instead of retaining a previous tab watcher', () => {
	assert.match(viewer, /if \(liveMode && currentFile\) \{\r?\n\t\t\tinvoke\('watch_file', \{ path: currentFile \}\)/);

	// The defect #296 fixed was `documentSession` re-issuing `watch_file` on
	// every load, so the watcher followed whichever document loaded last rather
	// than the active one. It used to be pinned as
	// `/isLiveMode\(\)\) invoke\('watch_file'/` — the exact one-line spelling
	// the defect happened to be written in, against a file where neither token
	// occurs any more. Rewriting the same call as an ordinary `if (…) { … }`
	// evaded it. What has to hold is who may call it: the effect above, alone.
	const watchers = filesMatching(readSourceFiles('src'), /invoke\(\s*'watch_file'/);
	assert.deepEqual(watchers, ['src/lib/MarkdownViewer.svelte'], 'one owner for the file watcher');

	const watchingEffects = callbackBodies(viewer, '$effect').filter((body) => /'watch_file'/.test(body));
	assert.equal(watchingEffects.length, 1, 'and one effect inside it');
	assert.match(watchingEffects[0], /invoke\('unwatch_file'\)/, 'the same effect gives the watcher up');

	const toggleLiveMode = sliceBetween(viewer, 'function toggleLiveMode', 'async function saveImageAs');
	assert.doesNotMatch(toggleLiveMode, /loadMarkdown\(/);
});
