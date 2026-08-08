import assert from 'node:assert/strict';
import test from 'node:test';

import { functionSource, offsetOf, readSource, sliceBetween, sliceFrom } from './sourceTree.js';

const viewer = readSource('src/lib/MarkdownViewer.svelte');
const styles = readSource('src/styles.css');

test('a right-click in the editor gets the editor menu, before any other rule claims it', () => {
	// #261/#266 was the document menu swallowing this event: it called
	// `preventDefault()` before checking where the click was, and its
	// full-viewport overlay then covered Monaco's menu, so Paste hit the
	// overlay. The fix then was to hand the event to Monaco.
	//
	// Markpad draws this menu itself now (#207), because Monaco's Paste reads
	// the clipboard through the webview and cannot work here. So the invariant
	// is no longer "Monaco gets the event first" — it is that the editor's own
	// branch runs before every other rule in the handler.
	//
	// The ordering matters for a reason that is easy to miss: Monaco takes
	// input through a hidden `<textarea>`, so the carve-out that leaves real
	// text fields their native menu would claim every right-click in the
	// editor if it came first.
	const handler = sliceBetween(viewer, 'function handleContextMenu(e: MouseEvent)', '\n\tfunction handleMouseOver');
	const editorBranch = offsetOf(handler, "closest('.editor-container')");
	const textFieldCarveOut = offsetOf(handler, "closest('input, textarea,");
	const documentMenu = offsetOf(handler, 'e.preventDefault();');

	assert.ok(editorBranch < textFieldCarveOut, "the hidden textarea must not claim the editor's right-click");
	assert.ok(editorBranch < documentMenu, 'the editor branch runs before the document menu');
	assert.match(handler, /showEditorContextMenu\(e\);\s*\n\s*return;/, 'and it shows a menu rather than bailing out');
});

test('the editor menu runs the same three functions the keyboard runs', () => {
	// One implementation per operation is the whole point: six entry points
	// (three keys, three menu items) and three functions. A menu item wired to
	// its own inline implementation would drift from the shortcut silently.
	const menu = functionSource(viewer, 'showEditorContextMenu');

	for (const fn of ['cutToClipboard', 'copyToClipboard', 'pasteFromClipboard']) {
		assert.match(menu, new RegExp(`editorPane\\?\\.${fn}\\(\\)`), `${fn} is what the menu item runs`);
	}
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
	const selector = sliceBetween(viewer, '\t.toc-toggle-floating {', '\n\t.toc-toggle-floating.expanded {');

	assert.match(selector, /background-color:\s*color-mix\(in srgb, var\(--color-canvas-default\) 82%, transparent\);/);
	assert.match(selector, /border:\s*1px solid var\(--color-border-default\);/);
	assert.match(selector, /box-shadow:\s*0 2px 8px rgba\(0, 0, 0, 0\.12\);/);
	assert.match(selector, /backdrop-filter:\s*blur\(8px\);/);
	assert.match(viewer, /\.toc-toggle-floating:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--color-accent-fg\);/);
	assert.doesNotMatch(viewer, /\.toc-toggle-floating\.in-edit-mode:not\(\.expanded\)/);
});

test('print layout gives document content paper-specific rhythm and boundaries', () => {
	const printStyles = sliceFrom(styles, '@media print {');

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
	const printStyles = sliceFrom(styles, '@media print {');

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

	// The paper padding above is set globally, so a component-scoped print rule
	// in MarkdownViewer.svelte would beat it: Svelte adds a hash class to its
	// own selectors, and `.markdown-body.svelte-xxxx { padding: 0 !important }`
	// outranks `.markdown-body { padding: 0.75in !important }`. Exactly that
	// rule lived in the component until 37b3693 removed it.
	//
	// This is searched over the whole component rather than over a slice from
	// `@media print {`: the component now has no print block at all, so slicing
	// to that marker sliced from -1 — the last character of the file — and the
	// assertion could not fail for the entire time it existed.
	assert.doesNotMatch(viewer, /@media print\s*\{[\s\S]*?\.markdown-body\s*\{[\s\S]*?padding:\s*0\s*!important;/);
});

test('print layout keeps wide metadata tables readable', () => {
	const printStyles = sliceFrom(styles, '@media print {');

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
