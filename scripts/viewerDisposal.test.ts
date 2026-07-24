import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

test('onMount initialization tracks and checks disposal around async work', () => {
	assert.match(viewer, /let disposed = false;/);
	assert.match(viewer, /if \(disposed\) return;/);
	assert.match(viewer, /if \(!disposed && args\?\.length > 0\)/);
	assert.match(viewer, /disposed = true;/);
});

test('listeners registered after disposal are released', () => {
	assert.match(viewer, /if \(disposed\) \{\s*unlisteners\.forEach\(\(unlisten\) => unlisten\(\)\);/s);
});
