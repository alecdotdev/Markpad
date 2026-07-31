import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const selectFile = viewer.slice(viewer.indexOf('async function selectFile'), viewer.indexOf('async function reloadFromDisk'));

test('Open File accepts multiple documents and loads each selected path', () => {
	assert.match(selectFile, /multiple: true/);
	assert.match(selectFile, /const paths = Array\.isArray\(selected\) \? selected : \[selected\];/);
	assert.match(selectFile, /for \(const path of paths\) await loadMarkdown\(path\);/);
});
