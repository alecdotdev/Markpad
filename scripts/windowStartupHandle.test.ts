import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './sourceTree.js';

const backend = readSource('src-tauri/src/lib.rs');

test('startup reuses the window handle returned by the builder', () => {
	assert.match(backend, /let window = window_builder\.build\(\)\?;/);
	assert.doesNotMatch(backend, /app\.get_webview_window\(label\)\.unwrap\(\)/);
});
