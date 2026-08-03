import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sliceBetween } from './sourceTree.js';

const findBar = readFileSync('src/lib/components/FindBar.svelte', 'utf8');

test('find keeps counting matches inside collapsed folds', () => {
	// Reference systems all keep hidden-but-present text findable and reveal
	// it on a hit: VS Code unfolds the region it jumps into, and Chrome makes
	// `hidden=until-found` / closed `<details>` content matchable precisely
	// because it can reveal it. Dropping the matches from the count would be
	// the `display: none` rule, which is not what a collapsed fold is.
	const acceptNode = sliceBetween(findBar, 'function isHostElement(', 'function isInsideHost(');

	assert.doesNotMatch(acceptNode, /is-collapsed/);
	assert.doesNotMatch(acceptNode, /foldable-content-wrapper/);
	assert.doesNotMatch(acceptNode, /markdown-alert-content/);
});

test('find knows both kinds of collapsed fold container', () => {
	assert.match(findBar, /\.foldable-content-wrapper\.is-collapsed/);
	assert.match(findBar, /\.markdown-alert-content\.is-collapsed/);
});

test('activating a match reveals the folds hiding it before scrolling to it', () => {
	const setActive = sliceBetween(findBar, 'function setActive(', 'export function next()');

	const reveal = setActive.indexOf('revealFoldsAround(');
	const scroll = setActive.indexOf('scrollIntoView(');

	assert.ok(reveal !== -1, 'setActive must reveal the collapsed folds around the match');
	assert.ok(scroll !== -1, 'setActive must still scroll the match into view');
	assert.ok(reveal < scroll, 'the fold has to open before the scroll target is measured');
});

test('revealing a fold goes through the viewer toggle instead of stripping the class', () => {
	// `collapsedHeaders` in MarkdownViewer.svelte is the source of truth for
	// fold state: it re-applies `is-collapsed` on every re-render and feeds
	// the ToC. Clearing the class here would create a second source of truth
	// that the next render silently reverts.
	const reveal = sliceBetween(findBar, 'function foldToggleFor(', 'export function clearHighlights()');

	assert.match(reveal, /\.header-fold-icon/);
	assert.match(reveal, /\.callout-toggle/);
	assert.match(reveal, /data-fold-target/);
	assert.match(reveal, /dispatchEvent\(\s*new MouseEvent\('click', \{ bubbles: true \}\)/);
	assert.doesNotMatch(findBar, /classList\.remove\(\s*['"]is-collapsed/);
	assert.doesNotMatch(findBar, /classList\.toggle\(\s*['"]is-collapsed/);
});

test('nested folds are opened outermost first', () => {
	const reveal = sliceBetween(findBar, 'function revealFoldsAround(', 'export function clearHighlights()');

	assert.match(reveal, /while \(curr && curr !== root\)/);
	assert.match(reveal, /collapsed\.reverse\(\)/);
});

test('the scroll is re-aimed once the fold height transition has settled', () => {
	// styles.css animates `.foldable-content-wrapper` height for 0.25s, so the
	// first scrollIntoView aims at a target that is still moving.
	const setActive = sliceBetween(findBar, 'function setActive(', 'export function next()');

	assert.match(setActive, /setTimeout\(/);
	assert.match(setActive, /FOLD_TRANSITION_MS/);
	assert.match(setActive, /isConnected/);
	assert.match(findBar, /const FOLD_TRANSITION_MS = (\d+);/);

	const ms = Number(findBar.match(/const FOLD_TRANSITION_MS = (\d+);/)?.[1]);
	assert.ok(ms >= 250, 'must outlast the 0.25s fold transition in styles.css');
});
