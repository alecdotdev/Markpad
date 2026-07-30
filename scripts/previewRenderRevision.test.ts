import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

test('preview rendering uses a revision and cleans up its debounce timer', () => {
	assert.match(viewer, /let previewRenderRevision = 0;/);
	assert.match(viewer, /const renderRevision = \+\+previewRenderRevision;/);
	assert.match(viewer, /return \(\) => clearTimeout\(timer\);/);
});

test('a completed preview render verifies its tab, content, and revision', () => {
	assert.match(viewer, /previewRenderRevision !== renderRevision/);
	assert.match(viewer, /tabManager\.activeTabId !== tabId/);
	assert.match(viewer, /currentTab\?\.rawContent !== rawContent/);
});
