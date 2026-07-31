import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync('src-tauri/src/window_runtime.rs', 'utf8');
const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

test('Live Mode routes a watcher notification to its watched path', () => {
	assert.match(runtime, /emit_to\(event_label\.as_str\(\), "file-changed", watched_path\.clone\(\)\)/);
	assert.match(viewer, /await appWindow\.listen\('file-changed', \(event\) => \{/);
	assert.match(viewer, /const changedPath = event\.payload as string;/);
	assert.match(viewer, /if \(!liveMode \|\| !currentFile \|\| changedPath !== currentFile\) return;/);
});

test('Live Mode follows the active file instead of retaining a previous tab watcher', () => {
	assert.match(viewer, /if \(liveMode && currentFile\) \{\n\t\t\tinvoke\('watch_file', \{ path: currentFile \}\)/);
	assert.doesNotMatch(readFileSync('src/lib/sessions/documentSession.svelte.ts', 'utf8'), /isLiveMode\(\)\) invoke\('watch_file'/);
	const toggleLiveMode = viewer.slice(viewer.indexOf('function toggleLiveMode'), viewer.indexOf('async function saveImageAs'));
	assert.doesNotMatch(toggleLiveMode, /loadMarkdown\(/);
});
