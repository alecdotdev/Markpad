import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './sourceTree.js';

const session = readSource('src/lib/sessions/documentSession.svelte.ts');

test('a transient missing-file read error preserves the open tab', () => {
	assert.doesNotMatch(session, /tabManager\.closeTab/);
	assert.match(session, /options\.onError\('Error loading file', error\);/);
});
