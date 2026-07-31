import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync('src/lib/components/Editor.svelte', 'utf8');
const syncEffect = editor.slice(editor.indexOf('if (editor && onscrollsync)'), editor.indexOf('\n\t$effect(() => {', editor.indexOf('if (editor && onscrollsync)') + 1));

test('typing does not initiate split scroll synchronization', () => {
	assert.match(syncEffect, /editor\.onDidScrollChange/);
	assert.doesNotMatch(syncEffect, /onDidChangeCursorPosition/);
});
