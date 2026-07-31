import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const styles = readFileSync('src/styles.css', 'utf8');

test('editor context menu is not intercepted by the document menu', () => {
	const start = viewer.indexOf('function handleContextMenu(e: MouseEvent)');
	const handler = viewer.slice(start, viewer.indexOf('\n\tfunction handleMouseOver', start));
	const editorReturn = handler.indexOf('if (isInsideEditor) return;');
	const preventDefault = handler.indexOf('e.preventDefault();');

	assert.ok(editorReturn !== -1, 'editor context menus must stay with Monaco');
	assert.ok(editorReturn < preventDefault, 'Monaco must receive the event before the document menu prevents it');
});

test('print layout releases measured fold heights before text reflows', () => {
	assert.match(
		styles,
		/@media print\s*\{[\s\S]*?\.foldable-content-wrapper\s*\{[\s\S]*?height:\s*auto\s*!important;/,
	);
	assert.match(
		styles,
		/@media print\s*\{[\s\S]*?\.foldable-content-wrapper\.is-collapsed\s*\{[\s\S]*?height:\s*0\s*!important;/,
	);
});

test('print layout lets the viewer pane escape the interactive split flex ratio', () => {
	assert.match(
		styles,
		/@media print\s*\{[\s\S]*?\.pane\.viewer-pane\s*\{[\s\S]*?flex:\s*none\s*!important;/,
	);
});

test('floating toc toggle keeps a visible translucent surface outside edit mode', () => {
	const selector = viewer.slice(
		viewer.indexOf('\t.toc-toggle-floating {'),
		viewer.indexOf('\n\t.toc-toggle-floating.expanded {'),
	);

	assert.match(selector, /background-color:\s*color-mix\(in srgb, var\(--color-canvas-default\) 82%, transparent\);/);
	assert.match(selector, /border:\s*1px solid var\(--color-border-default\);/);
	assert.match(selector, /box-shadow:\s*0 2px 8px rgba\(0, 0, 0, 0\.12\);/);
	assert.match(selector, /backdrop-filter:\s*blur\(8px\);/);
	assert.match(viewer, /\.toc-toggle-floating:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--color-accent-fg\);/);
	assert.doesNotMatch(viewer, /\.toc-toggle-floating\.in-edit-mode:not\(\.expanded\)/);
});
