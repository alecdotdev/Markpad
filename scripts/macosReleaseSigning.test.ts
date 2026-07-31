import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/build.yml', 'utf8');

test('the release workflow imports a Developer ID certificate before building macOS', () => {
	assert.match(workflow, /name: Import Apple Developer ID certificate/);
	assert.match(workflow, /APPLE_CERTIFICATE: \$\{\{ secrets\.APPLE_CERTIFICATE \}\}/);
	assert.match(workflow, /security import certificate\.p12/);
	assert.match(workflow, /APPLE_SIGNING_IDENTITY/);
});

test('the macOS release build receives notarization credentials', () => {
	const macosBuild = workflow.slice(workflow.indexOf('name: Build MacOS (Universal)'));

	assert.match(macosBuild, /APPLE_ID: \$\{\{ secrets\.APPLE_ID \}\}/);
	assert.match(macosBuild, /APPLE_PASSWORD: \$\{\{ secrets\.APPLE_PASSWORD \}\}/);
	assert.match(macosBuild, /APPLE_TEAM_ID: \$\{\{ secrets\.APPLE_TEAM_ID \}\}/);
});
