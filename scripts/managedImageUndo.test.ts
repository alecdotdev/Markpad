import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	contentReferencesImage,
	embedTarget,
	forgetClosedTabs,
	imagePathOf,
	managedImageFromCopy,
	resolveManagedImageRedo,
	resolveManagedImageUndo,
	type ManagedImage,
} from '../src/lib/utils/managedImages.js';

const editor = readFileSync(new URL('../src/lib/components/Editor.svelte', import.meta.url), 'utf8');

function image(tabId: string, relativePath: string, alt = 'alt'): ManagedImage {
	return managedImageFromCopy({
		tabId,
		embed: `![${alt}](${relativePath})`,
		parentDir: 'C:/notes',
		imageDirectory: 'img',
		relativePath,
	});
}

test('undo metadata retains the collision-resolved filename and paste-time directory', () => {
	assert.deepEqual(
		managedImageFromCopy({
			tabId: 'tab-1',
			embed: '![alt](img/logo_1710000000.png)',
			parentDir: 'C:/notes',
			imageDirectory: 'img',
			relativePath: 'img/logo_1710000000.png',
		}),
		{
			tabId: 'tab-1',
			embed: '![alt](img/logo_1710000000.png)',
			parentDir: 'C:/notes',
			imageDirectory: 'img',
			filename: 'logo_1710000000.png',
		},
	);
});

test("an undo never reaches another tab's image", () => {
	// The editor keeps one component instance across tab switches. Undoing in
	// tab B used to inspect the newest entry from any tab, find its embed
	// missing from B's buffer -- a different document -- and delete a file
	// tab A was still displaying.
	const images = [image('tab-a', 'img/a.png'), image('tab-b', 'img/b.png')];
	const undoInB = resolveManagedImageUndo(images, 'tab-b', 'text with no embeds');
	assert.equal(undoInB.removed?.filename, 'b.png');
	assert.deepEqual(
		undoInB.remaining.map((i) => i.filename),
		['a.png'],
	);

	// Tab A's image survives an undo in B even when B's buffer mentions nothing.
	const onlyA = resolveManagedImageUndo([image('tab-a', 'img/a.png')], 'tab-b', '');
	assert.equal(onlyA.removed, null);
	assert.equal(onlyA.remaining.length, 1);
});

test('editing the caption does not read as removing the image', () => {
	// `![alt](img/a.png)` -> `![logo](img/a.png)`. Matching the whole embed
	// string deleted a file the document still pointed at.
	const stored = image('tab-a', 'img/a.png', 'alt');
	assert.equal(embedTarget(stored.embed), 'img/a.png');
	assert.equal(contentReferencesImage('before ![logo](img/a.png) after', stored), true);
	assert.equal(resolveManagedImageUndo([stored], 'tab-a', '![logo](img/a.png)').removed, null);
});

test('an image whose target is gone is still collected', () => {
	const stored = image('tab-a', 'img/a.png');
	assert.equal(contentReferencesImage('nothing here', stored), false);
	assert.equal(
		resolveManagedImageUndo([stored], 'tab-a', 'nothing here').removed?.filename,
		'a.png',
	);
});

test('a similarly named file is not mistaken for the managed one', () => {
	const stored = image('tab-a', 'img/a.png');
	assert.equal(contentReferencesImage('![x](img/other-a.png)', stored), false);
});

test('an unparseable embed falls back to the literal string', () => {
	// Deleting a referenced file is the worse failure, so an embed we cannot
	// read is treated as present whenever its exact text appears.
	const odd: ManagedImage = { ...image('tab-a', 'img/a.png'), embed: 'not an embed' };
	assert.equal(embedTarget(odd.embed), null);
	assert.equal(contentReferencesImage('prose not an embed prose', odd), true);
	assert.equal(contentReferencesImage('prose', odd), false);
});

test('a redo takes the entry back so the file is not deleted twice', () => {
	const stored = image('tab-a', 'img/a.png');
	const afterUndo = resolveManagedImageUndo([stored], 'tab-a', '');
	assert.equal(afterUndo.removed?.filename, 'a.png');

	const undone = [afterUndo.removed!];
	const afterRedo = resolveManagedImageRedo(undone, 'tab-a', '![alt](img/a.png)');
	assert.equal(afterRedo.restored?.filename, 'a.png');
	assert.deepEqual(afterRedo.remaining, []);

	// And a redo in a different tab leaves it alone.
	assert.equal(resolveManagedImageRedo(undone, 'tab-b', '![alt](img/a.png)').restored, null);
});

test('a redo whose embed is absent restores nothing', () => {
	const undone = [image('tab-a', 'img/a.png')];
	assert.equal(resolveManagedImageRedo(undone, 'tab-a', 'unrelated').restored, null);
});

test('closing a tab drops its bookkeeping', () => {
	const images = [image('tab-a', 'img/a.png'), image('tab-b', 'img/b.png')];
	assert.deepEqual(
		forgetClosedTabs(images, new Set(['tab-b'])).map((i) => i.filename),
		['b.png'],
	);
});

test('the delete target is built from the values captured at insert time', () => {
	assert.equal(imagePathOf(image('tab-a', 'img/a.png')), 'C:/notes/img/a.png');
});

test('the editor routes undo and redo through the scoped helpers', () => {
	assert.match(editor, /resolveManagedImageUndo\(\s*\n\s*managedImages,\s*\n\s*activeTabId,/);
	assert.match(editor, /if \(e\.isRedoing && undoneImages\.length > 0\)/);
	// The owning tab is captured before the first await, not read back
	// afterwards -- the copy and the edit are several round trips apart.
	assert.match(editor, /const pasteTabId = tabManager\.activeTabId;/);
	assert.match(editor, /const dropTabId = tabManager\.activeTabId;/);
	assert.doesNotMatch(editor, /currentContent\.includes\(last\.embed\)/);
});
