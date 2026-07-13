import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Fold state is keyed by `h.id || textContent`. comrak emits the
// deduplicated heading id on an empty inner <a class="anchor">, not on the
// heading element, so without promotion every fold consumer falls back to
// heading text: duplicate titles share one fold state, and the ToC's
// id-based fold keys never match the preview's text-based ones.

test('processMarkdownHtml promotes the anchor id onto the heading element', () => {
	const source = readFileSync('src/lib/utils/markdown.ts', 'utf8');

	const headingLoop = source.slice(source.indexOf('querySelectorAll("h1, h2, h3, h4, h5, h6")'));
	assert.match(headingLoop, /querySelector\("a\.anchor"\)/, 'heading loop looks up the comrak anchor');
	assert.match(headingLoop, /h\.id = \w+\.id/, 'anchor id is promoted onto the heading');
	assert.match(headingLoop, /removeAttribute\("id"\)/, 'anchor id is removed so document ids stay unique');
});

test('fold restore keys by heading id before falling back to text', () => {
	const source = readFileSync('src/lib/utils/markdown.ts', 'utf8');
	assert.match(source, /const key = h\.id \|\| h\.textContent/, 'restore key prefers the (now populated) heading id');
});

test('viewer fold handlers key by heading id before falling back to text', () => {
	const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
	assert.match(viewer, /foldableHeader\.id \|\| foldableHeader\.textContent/, 'preview chevron keys by heading id first');
	assert.match(viewer, /\[id="\$\{CSS\.escape\(key\)\}"\]\.foldable-header/, 'toggleFold resolves the heading by id');
});
