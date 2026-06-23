import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getTabFileActions, hasRealFilePath } from '../src/lib/utils/tabFileActions.js';

test('tab file actions are enabled for saved files', () => {
	const actions = getTabFileActions('/tmp/notes/example.md');

	assert.equal(hasRealFilePath('/tmp/notes/example.md'), true);
	assert.deepEqual(
		actions.map((action) => [action.id, action.labelKey, action.disabled]),
		[
			['copy-path', 'menu.copyFullPath', false],
			['open-location', 'menu.openFileLocation', false],
		]
	);
});

test('tab file actions are disabled for tabs without a real file path', () => {
	for (const path of ['', 'HOME']) {
		assert.equal(hasRealFilePath(path), false);
		assert.deepEqual(
			getTabFileActions(path).map((action) => [action.id, action.disabled]),
			[
				['copy-path', true],
				['open-location', true],
			]
		);
	}
});
