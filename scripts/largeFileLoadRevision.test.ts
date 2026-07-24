import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');

test('large-file completion requires the current clean load revision and unchanged view mode', () => {
	assert.match(viewer, /const loadRevisionByTab = new Map<string, number>\(\);/);
	assert.match(viewer, /const fullLoadRevision = \(loadRevisionByTab\.get\(activeId\) \?\? 0\) \+ 1;/);
	assert.match(viewer, /loadRevisionByTab\.set\(activeId, fullLoadRevision\);/);
	assert.match(
		viewer,
		/loadRevisionByTab\.get\(activeId\) === fullLoadRevision[\s\S]*!targetTab\.isDirty[\s\S]*targetTab\.isEditing === initialIsEditing[\s\S]*targetTab\.isSplit === initialIsSplit/,
	);
});
