import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync('src-tauri/src/window_runtime.rs', 'utf8');
const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf8');
const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

test('macOS open-document events preserve every delivered file path', () => {
	assert.match(runtime, /startup_files: Mutex<Vec<String>>/);
	assert.match(tauriLib, /for url in urls/);
	assert.match(tauriLib, /startup_files\.lock\(\)\.unwrap\(\)\.push\(path_str\.clone\(\)\)/);
	assert.match(runtime, /startup_files\.lock\(\)\.unwrap\(\)\.drain\(\.\.\)\.collect\(\)/);
	assert.match(runtime, /for path in startup_files\.into_iter\(\)\.rev\(\)/);
	assert.match(viewer, /for \(const path of args\) await loadMarkdown\(path\);/);
});
