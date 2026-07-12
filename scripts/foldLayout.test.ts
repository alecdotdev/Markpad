import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('fold layout observes rendered content and publishes its measured height', () => {
	const source = readFileSync('src/lib/utils/foldLayout.ts', 'utf8');

	assert.match(source, /new ResizeObserver/);
	assert.match(source, /--fold-content-height/);
	assert.match(source, /requestAnimationFrame/);
});

test('fold wrapper animates an explicit measured height instead of a fractional grid track', () => {
	const styles = readFileSync('src/styles.css', 'utf8');
	const expandedRule = styles.match(/\.foldable-content-wrapper\s*\{([^}]*)\}/)?.[1] || '';

	assert.match(expandedRule, /height:\s*var\(--fold-content-height/);
	assert.doesNotMatch(expandedRule, /grid-template-rows:\s*1fr/);
	assert.match(styles, /foldable-content-wrapper\.is-collapsed[\s\S]*height:\s*0/);
});

test('preview lifecycle starts and cleans up fold observation', () => {
	const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

	assert.match(viewer, /observeFoldLayout\((?:markdownBody|body)\)/);
	assert.match(viewer, /stopObservingFoldLayout\?\.\(\)/);
});
