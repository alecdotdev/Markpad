import assert from 'node:assert/strict';
import test from 'node:test';
import { managedImageFromCopy } from '../src/lib/utils/managedImages.js';

test('undo metadata retains the collision-resolved image filename and paste-time directory', () => {
	const image = managedImageFromCopy({
		embed: '![alt](img/logo_1710000000.png)',
		parentDir: 'C:/notes',
		imageDirectory: 'img',
		relativePath: 'img/logo_1710000000.png',
	});

	assert.deepEqual(image, {
		embed: '![alt](img/logo_1710000000.png)',
		parentDir: 'C:/notes',
		imageDirectory: 'img',
		filename: 'logo_1710000000.png',
	});
});
