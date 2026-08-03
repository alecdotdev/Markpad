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

// Salvaged from `findCollapsedMatches.test.ts`, which was deleted for asserting
// the spelling of FindBar.svelte (it stayed green with `revealFoldsAround` made
// a no-op). This assertion is a different kind: it couples a TypeScript constant
// to a CSS duration in another file. Nothing else compares the two, and when
// FindBar's re-aim timer fires before the height transition settles the scroll
// lands on a target that is still moving — a defect that only shows up as "find
// sometimes scrolls to the wrong place".
test('the find-bar fold re-aim delay outlasts the CSS fold transition', () => {
	const findBar = readFileSync('src/lib/components/FindBar.svelte', 'utf8');
	const styles = readFileSync('src/styles.css', 'utf8');

	const declared = findBar.match(/const FOLD_TRANSITION_MS = (\d+);/);
	assert.ok(declared, 'FindBar.svelte must declare the delay it waits for the fold to settle');

	const expandedRule = styles.match(/\.foldable-content-wrapper\s*\{([^}]*)\}/)?.[1] || '';
	const transition = expandedRule.match(/transition:[^;]*?height\s+([\d.]+)s/);
	assert.ok(transition, 'styles.css must animate the fold wrapper height');

	assert.ok(
		Number(declared[1]) >= Number(transition[1]) * 1000,
		`FOLD_TRANSITION_MS (${declared[1]}ms) must outlast the ${transition[1]}s height transition`,
	);
});

test('preview lifecycle starts and cleans up fold observation', () => {
	const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

	assert.match(viewer, /observeFoldLayout\((?:markdownBody|body)\)/);
	assert.match(viewer, /stopObservingFoldLayout\?\.\(\)/);
});

test('fold measurement pauses while the preview pane is hidden by edit mode', () => {
	const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

	assert.match(viewer, /if \(!html \|\| !body \|\| \(isEditing && !isSplit\)\) return;/);
});
