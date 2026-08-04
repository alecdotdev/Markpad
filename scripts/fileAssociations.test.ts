import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './sourceTree.js';

const config = JSON.parse(readSource('src-tauri/tauri.conf.json')) as {
	bundle: { fileAssociations: Array<{ ext: string[] }> };
};

test('installer advertises only Markdown file associations', () => {
	const extensions = config.bundle.fileAssociations.flatMap((association) => association.ext);
	assert.deepEqual(extensions, ['md', 'markdown']);
	assert.equal(extensions.includes('txt'), false);
});
