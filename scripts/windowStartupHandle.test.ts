import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const backend = readFileSync('src-tauri/src/lib.rs', 'utf8');

test('startup reuses the window handle returned by the builder', () => {
	assert.match(backend, /let window = window_builder\.build\(\)\?;/);
	assert.doesNotMatch(backend, /app\.get_webview_window\(label\)\.unwrap\(\)/);
});
