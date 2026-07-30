import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const session = readFileSync(new URL('../src/lib/sessions/documentSession.svelte.ts', import.meta.url), 'utf8');

test('preview task toggles transform the active in-memory buffer before saving', () => {
	const taskToggle = session.match(/async function toggleTaskCheckbox[\s\S]*?\n\t}\n\n\treturn/);
	assert.ok(taskToggle);
	assert.doesNotMatch(taskToggle[0], /read_file_content/);
	assert.match(taskToggle[0], /const raw = tab\.rawContent;/);
	assert.match(taskToggle[0], /tabManager\.updateTabRawContent\(tab\.id, updated\);/);
	assert.match(taskToggle[0], /await saveContent\(tab\.id\)/);
});
