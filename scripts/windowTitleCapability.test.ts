import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('all Markpad windows may update their native title', () => {
	const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8')) as {
		permissions: string[];
	};

	assert.ok(
		capability.permissions.includes('core:window:allow-set-title'),
		'window tags and active document names call appWindow.setTitle(), which requires this permission',
	);
});
