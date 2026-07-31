import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
	bundle: { fileAssociations: Array<{ ext: string[] }> };
};

test('installer advertises only Markdown file associations', () => {
	const extensions = config.bundle.fileAssociations.flatMap((association) => association.ext);
	assert.deepEqual(extensions, ['md', 'markdown']);
	assert.equal(extensions.includes('txt'), false);
});
