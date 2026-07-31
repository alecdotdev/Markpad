import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const session = readFileSync('src/lib/sessions/documentSession.svelte.ts', 'utf8');

test('a transient missing-file read error preserves the open tab', () => {
	assert.doesNotMatch(session, /tabManager\.closeTab/);
	assert.match(session, /options\.onError\('Error loading file', error\);/);
});
