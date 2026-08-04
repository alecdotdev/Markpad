import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './sourceTree.js';

const workflow = readSource('.github/workflows/test.yml');

test('pull-request checks reject vulnerabilities anywhere in the resolved lockfile', () => {
	assert.match(workflow, /name: audit complete dependency lockfile[\s\S]*run: npm audit(?:\s|$)/);
	assert.doesNotMatch(workflow, /npm audit --omit=dev/);
});
