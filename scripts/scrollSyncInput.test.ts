import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync('src/lib/components/Editor.svelte', 'utf8');
// Anchor on the tail of the guard, not the whole condition: the effect gained an
// `editorReady &&` term when Monaco moved behind a dynamic import, and an
// exact-match marker silently sliced an empty string instead of failing loudly.
const syncStart = editor.indexOf('&& onscrollsync)');
assert.notEqual(syncStart, -1, 'expected to find the scroll-sync effect guard');
const syncEffect = editor.slice(syncStart, editor.indexOf('\n\t$effect(() => {', syncStart + 1));

test('typing does not initiate split scroll synchronization', () => {
	assert.match(syncEffect, /editor\.onDidScrollChange/);
	assert.doesNotMatch(syncEffect, /onDidChangeCursorPosition/);
});
