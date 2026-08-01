import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/build.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

test('release builds install the locked dependency graph', () => {
	assert.match(workflow, /name: Install Frontend Dependencies\s+run: npm ci/);
	assert.doesNotMatch(workflow, /npm install/);
});

test('portable executables are not mislabeled as installers', () => {
	assert.doesNotMatch(workflow, /MarkpadInstaller_/);
	assert.match(workflow, /bundle\/nsis.*-setup\.exe/);
});

test('the test bundle command uses an isolated builder', () => {
	assert.equal(packageJson.scripts['build:test-bundle'], 'node scripts/build-test-bundle.mjs');
});
