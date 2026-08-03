import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sliceBetween } from './sourceTree.js';

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
	assert.match(viewer, /if \(liveMode && currentFile\) \{\n\t\t\tinvoke\('watch_file', \{ path: currentFile \}\)/);
	assert.doesNotMatch(readFileSync('src/lib/sessions/documentSession.svelte.ts', 'utf8'), /isLiveMode\(\)\) invoke\('watch_file'/);
	const toggleLiveMode = sliceBetween(viewer, 'function toggleLiveMode', 'async function saveImageAs');
	assert.doesNotMatch(toggleLiveMode, /loadMarkdown\(/);
});
