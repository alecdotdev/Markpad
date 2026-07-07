import assert from 'node:assert/strict';
import { test } from 'node:test';

import { askToOpenExportedFile } from '../src/lib/utils/openExportedFile.js';

test('askToOpenExportedFile opens the exported file after user confirmation', async () => {
	const opened: string[] = [];
	const asked: Array<{ message: string; options?: unknown }> = [];

	const result = await askToOpenExportedFile('C:/Docs/export.html', 'HTML', {
		ask: async (message, options) => {
			asked.push({ message, options });
			return true;
		},
		openPath: async (path) => {
			opened.push(path);
		},
		labels: {
			title: 'Open exported file?',
			message: 'Open exported HTML file now?',
		},
	});

	assert.equal(result, 'opened');
	assert.deepEqual(opened, ['C:/Docs/export.html']);
	assert.equal(asked[0]?.message, 'Open exported HTML file now?');
	assert.deepEqual(asked[0]?.options, {
		title: 'Open exported file?',
		kind: 'info',
	});
});

test('askToOpenExportedFile leaves the file closed when user declines', async () => {
	const opened: string[] = [];

	const result = await askToOpenExportedFile('/tmp/export.html', 'HTML', {
		ask: async () => false,
		openPath: async (path) => {
			opened.push(path);
		},
		labels: {
			title: 'Open exported file?',
			message: 'Open exported HTML file now?',
		},
	});

	assert.equal(result, 'declined');
	assert.deepEqual(opened, []);
});

test('askToOpenExportedFile reports opener failures without throwing', async () => {
	const errors: unknown[] = [];

	const result = await askToOpenExportedFile('/tmp/export.html', 'HTML', {
		ask: async () => true,
		openPath: async () => {
			throw new Error('no default app');
		},
		onError: (error) => {
			errors.push(error);
		},
		labels: {
			title: 'Open exported file?',
			message: 'Open exported HTML file now?',
		},
	});

	assert.equal(result, 'failed');
	assert.equal(errors.length, 1);
	assert.match(String(errors[0]), /no default app/);
});
