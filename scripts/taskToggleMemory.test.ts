import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');

test('preview task toggles transform the active in-memory buffer before saving', () => {
	const taskToggle = viewer.match(/async function toggleTaskCheckbox[\s\S]*?\n\t}\n\n\n\n\tfunction saveRecentFile/);
	assert.ok(taskToggle);
	assert.doesNotMatch(taskToggle[0], /read_file_content/);
	assert.match(taskToggle[0], /const raw = tab\.rawContent;/);
	assert.match(taskToggle[0], /tabManager\.updateTabRawContent\(tab\.id, updated\);/);
	assert.match(taskToggle[0], /await saveContent\(tab\.id\)/);
});
