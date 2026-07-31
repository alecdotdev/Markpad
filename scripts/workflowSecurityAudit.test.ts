import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/test.yml', 'utf8');

test('pull-request checks reject vulnerable production dependencies', () => {
	assert.match(workflow, /name: audit production dependencies[\s\S]*run: npm audit --omit=dev/);
});
