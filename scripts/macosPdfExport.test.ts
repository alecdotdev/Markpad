import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('all Markpad webviews may invoke Tauri native printing', () => {
	const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8')) as {
		windows: string[];
		permissions: string[];
	};

	assert.deepEqual(capability.windows, ['main', 'installer', 'window-*']);
	assert.ok(
		capability.permissions.includes('core:webview:allow-print'),
		'macOS replaces window.print() with Tauri native printing, which requires this permission',
	);
});
