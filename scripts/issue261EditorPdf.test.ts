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
	// This test used to require the opposite of the line below: a collapsed
	// fold was pinned to `height: 0 !important` on paper, which is how a
	// collapsed section came to be missing from the PDF entirely while the
	// HTML export of the same document contained it. The two export routes now
	// both hand over the whole document; scripts/exportFoldParity.test.ts
	// resolves the cascade to prove the section is actually visible rather than
	// merely un-pinned here.
	assert.match(
		styles,
		/@media print\s*\{[\s\S]*?\.foldable-content-wrapper\.is-collapsed\s*\{[\s\S]*?height:\s*auto\s*!important;/,
	);
	assert.doesNotMatch(
		styles,
		/@media print\s*\{[\s\S]*?\.foldable-content-wrapper\.is-collapsed\s*\{[^}]*height:\s*0/,
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

test('print layout gives document content paper-specific rhythm and boundaries', () => {
	const printStyles = styles.slice(styles.indexOf('@media print {'));

	assert.match(printStyles, /\.markdown-body h1,[\s\S]*?line-height:\s*1\.2;/);
	assert.match(printStyles, /\.markdown-body p\s*\{[\s\S]*?margin:\s*0 0 0\.75em;/);
	assert.match(printStyles, /\.markdown-body ul,[\s\S]*?padding-left:\s*1\.5em;/);
	assert.match(printStyles, /\.markdown-body blockquote\s*\{[\s\S]*?border-left:\s*3px solid #bbb;/);
	assert.match(printStyles, /\.markdown-body pre\s*\{[\s\S]*?break-inside:\s*auto;/);
	assert.match(printStyles, /\.markdown-body pre\s*\{[\s\S]*?border:\s*1px solid #d0d7de;/);
	assert.match(printStyles, /\.markdown-body img\s*\{[\s\S]*?max-width:\s*100%\s*!important;/);
	assert.match(printStyles, /\.markdown-body table\s*\{[\s\S]*?margin:\s*1em 0;/);
});

test('print layout paints a theme-independent page and keeps Markdown alerts intact', () => {
	const printStyles = styles.slice(styles.indexOf('@media print {'));
	const viewerPrintStyles = viewer.slice(viewer.indexOf('\t@media print {'));

	assert.match(printStyles, /@page\s*\{[\s\S]*?margin:\s*0;/);
	assert.match(printStyles, /\.markdown-body\s*\{[\s\S]*?box-sizing:\s*border-box\s*!important;/);
	assert.match(printStyles, /\.markdown-body\s*\{[\s\S]*?padding:\s*0\.75in\s*!important;/);
	assert.match(printStyles, /\.markdown-body\s*\{[\s\S]*?box-decoration-break:\s*clone\s*!important;/);
	assert.match(printStyles, /\.markdown-body\s*\{[\s\S]*?-webkit-box-decoration-break:\s*clone\s*!important;/);
	assert.match(printStyles, /\.markdown-body\s*\{[\s\S]*?print-color-adjust:\s*exact\s*!important;/);
	assert.match(
		printStyles,
		/\.markdown-body \.markdown-alert\s*\{[\s\S]*?page-break-inside:\s*avoid\s*!important;[\s\S]*?break-inside:\s*avoid\s*!important;/,
	);
	assert.match(printStyles, /\.markdown-body \.markdown-alert\s*\{[\s\S]*?box-decoration-break:\s*clone\s*!important;/);
	assert.match(printStyles, /\.markdown-body details\.markdown-alert\s*\{[\s\S]*?break-inside:\s*avoid\s*!important;/);
	assert.match(printStyles, /\.markdown-body tr\s*\{[\s\S]*?break-inside:\s*avoid;/);
	assert.doesNotMatch(viewerPrintStyles, /\.markdown-body\s*\{[\s\S]*?padding:\s*0\s*!important;/);
});

test('print layout keeps wide metadata tables readable', () => {
	const printStyles = styles.slice(styles.indexOf('@media print {'));

	// Diagram colours are no longer patched from CSS — the export re-renders
	// them with Mermaid's light theme instead (see utils/mermaidPrint.ts).
	// Recolouring by class name silently half-applied: sequence-diagram
	// actors have no `.node` ancestor, so their fill rule missed while the
	// label rule landed, leaving dark text on a near-black box.
	assert.doesNotMatch(printStyles, /\.mermaid-diagram svg[^{]*\{[^}]*fill:/);
	assert.match(printStyles, /\.markdown-body table\s*\{[\s\S]*?table-layout:\s*auto\s*!important;/);
	assert.match(printStyles, /\.markdown-body table th,[\s\S]*?overflow-wrap:\s*break-word\s*!important;/);
	assert.match(printStyles, /\.markdown-body \.frontmatter-summary\s*\{[\s\S]*?box-sizing:\s*border-box\s*!important;/);
	assert.match(printStyles, /\.markdown-body \.frontmatter-title\s*\{[\s\S]*?min-width:\s*0\s*!important;/);
});
