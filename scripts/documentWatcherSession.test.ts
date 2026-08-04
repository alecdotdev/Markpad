import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource, sliceFrom } from './sourceTree.js';

const session = readSource('src/lib/sessions/documentSession.svelte.ts');

test('self writes suppress watcher reloads only during their grace period', () => {
	const handler = sliceFrom(session, 'function shouldReloadExternalChange');
	assert.match(handler, /if \(Date\.now\(\) < until\) return false;/);
	assert.match(handler, /selfWriteUntilByPath\.delete\(path\);/);
	assert.match(handler, /return true;/);
});
