import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource, sliceFrom } from './sourceTree.js';

// Fold state is keyed by `h.id || textContent`. comrak emits the
// deduplicated heading id on an empty inner <a class="anchor">, not on the
// heading element, so without promotion every fold consumer falls back to
// heading text: duplicate titles share one fold state, and the ToC's
// id-based fold keys never match the preview's text-based ones.

test('processMarkdownHtml promotes the anchor id onto the heading element', () => {
	const source = readSource('src/lib/utils/markdown.ts');

	const headingLoop = sliceFrom(source, 'querySelectorAll("h1, h2, h3, h4, h5, h6")');
	assert.match(headingLoop, /querySelector\("a\.anchor"\)/, 'heading loop looks up the comrak anchor');
	assert.match(headingLoop, /h\.id = \w+\.id/, 'anchor id is promoted onto the heading');
	assert.match(headingLoop, /removeAttribute\("id"\)/, 'anchor id is removed so document ids stay unique');
});

test('fold restore keys by heading id before falling back to text', () => {
	const source = readSource('src/lib/utils/markdown.ts');
	assert.match(source, /const \w+ = \w+\.id \|\| \w+\.textContent/, 'restore key prefers the (now populated) heading id');
});

test('viewer fold handlers key by heading id before falling back to text', () => {
	const viewer = readSource('src/lib/MarkdownViewer.svelte');
	assert.match(viewer, /foldableHeader\.id \|\| foldableHeader\.textContent/, 'preview chevron keys by heading id first');
	assert.match(viewer, /\[id="\$\{CSS\.escape\(key\)\}"\]\.foldable-header/, 'toggleFold resolves the heading by id');
});
