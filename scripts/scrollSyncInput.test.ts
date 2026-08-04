import assert from 'node:assert/strict';
import test from 'node:test';

import { callbackBodies, readSource } from './sourceTree.js';

// The effect is identified by what it does — it is the one that reads
// `onscrollsync` — not by where its text starts and stops.
//
// It used to be sliced between `'&& onscrollsync)'` and `'\n\t$effect(() => {'`,
// and both halves of that were the same kind of fragile. The start anchor had
// already drifted once, silently: the original marker spelled the whole guard
// condition, the effect gained an `editorReady &&` term when Monaco moved behind
// a dynamic import, and the slice became empty rather than failing — which is
// what the shortened anchor and its `notEqual(-1)` were added for. The end
// anchor never got that guard, and it depends on the *next* effect being
// tab-indented and spelled `$effect(() => {`; write it any other way and this
// file silently starts asserting about the rest of the component.
const editor = readSource('src/lib/components/Editor.svelte');
const syncEffects = callbackBodies(editor, '$effect').filter((body) => body.includes('onscrollsync'));
assert.equal(syncEffects.length, 1, `expected exactly one $effect reading onscrollsync (got ${syncEffects.length})`);
const syncEffect = syncEffects[0];

test('typing does not initiate split scroll synchronization', () => {
	assert.match(syncEffect, /editor\.onDidScrollChange/);
	assert.doesNotMatch(syncEffect, /onDidChangeCursorPosition/);
});
