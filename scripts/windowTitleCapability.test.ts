import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './sourceTree.js';

test('all Markpad windows may update their native title', () => {
	const capability = JSON.parse(readSource('src-tauri/capabilities/default.json')) as {
		permissions: string[];
	};

	assert.ok(
		capability.permissions.includes('core:window:allow-set-title'),
		'window tags and active document names call appWindow.setTitle(), which requires this permission',
	);
});
