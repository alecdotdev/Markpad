import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/test.yml', 'utf8');

test('pull-request checks reject vulnerabilities anywhere in the resolved lockfile', () => {
	assert.match(workflow, /name: audit complete dependency lockfile[\s\S]*run: npm audit(?:\s|$)/);
	assert.doesNotMatch(workflow, /npm audit --omit=dev/);
});
