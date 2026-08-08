/**
 * #90: "Edit" in the preview's context menu opens the editor ON the fragment
 * that was right-clicked, and highlights it.
 *
 * The mapping this needs already exists. comrak runs with
 * `options.render.sourcepos = true` (`markdown_options` in
 * src-tauri/src/lib.rs), so every rendered element carries the source range it
 * came from, and `previewAnchor.ts` is the module that reads those ranges for
 * the tab's reading position and for split-view scroll sync. This feature is a
 * third consumer of the same attribute, not a third mapping: it resolves an
 * element to a `LineRange` with the parser those two already use, and hands it
 * to the one line-to-editor jump in `Editor.svelte` — the one the outline
 * already calls through `revealHeader`.
 *
 * Two facts about `data-sourcepos` that the tests below pin, because getting
 * either wrong is silent:
 *
 *   - INLINE nodes carry a range, not just blocks. Recorded from
 *     `convert_markdown` at comrak 0.54:
 *
 *       <p data-sourcepos="3:1-3:67">A paragraph with
 *         <strong data-sourcepos="3:18-3:30">bold text</strong> and an
 *         <img data-sourcepos="3:39-3:53" src="img.png" alt="alt" />
 *         inline image.</p>
 *
 *     which is what makes "jump to the selected image" land on the image's own
 *     line rather than on the whole paragraph.
 *
 *   - Only the LINE numbers are meaningful against the buffer the user edits.
 *     comrak parses the output of `convert_markdown`'s preprocessing, and that
 *     pipeline is line-preserving, not column-preserving. Recorded from the
 *     same renderer, for the raw line `Math $a+b$ then ![alt](img.png) here.`:
 *
 *       <p data-sourcepos="3:1-3:44">…<img data-sourcepos="3:24-3:38" …
 *
 *     The image really starts at raw column 18; the math mask substitutes a
 *     token longer than `$a+b$` and every column after it on the line is off
 *     by the difference. So the jump selects whole lines, and nothing here
 *     ever reads a column.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	installShimDom,
	NODE_TEXT,
	parseHtml,
	type ShimElement,
	type ShimNode,
} from './renderProtocolDom.ts';
import { functionSource, readSource, sliceFrom } from './sourceTree.js';

installShimDom();

// `processMarkdownHtml` resolves every local image through Tauri's
// `convertFileSrc`, which reads `window.__TAURI_INTERNALS__`. Without it the
// resolution throws, the app catches it, and the `<img>` is left alone — which
// is exactly the branch the "does the range survive the rewrite" test must NOT
// be allowed to take.
(globalThis as unknown as Record<string, unknown>).window = {
	__TAURI_INTERNALS__: {
		convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
	},
};

const { processMarkdownHtml } = await import('../src/lib/utils/markdown.ts');
const { findSourceLineRange, mergeSourceLineRanges } = await import(
	'../src/lib/utils/previewAnchor.ts'
);

const editorSource = readSource(new URL('../src/lib/components/Editor.svelte', import.meta.url));
const viewerSource = readSource(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url));

const FILE_PATH = '/documents/notes.md';

/**
 * comrak-shaped output for
 *
 *   1  # Notes
 *   2
 *   3  A paragraph with **bold text** and an ![alt](img.png) inline image.
 *   4
 *   5  ![standalone](pic.png)
 *   6
 *   7  Trailing prose
 *   8  over two lines.
 *
 * taken from `convert_markdown`, hardbreaks and heading anchor included, then
 * put through the app's own `processMarkdownHtml` — which is where the fold
 * wrapper that carries no source range of its own appears.
 */
const RENDERED = processMarkdownHtml(
	'<h1 id="notes" data-sourcepos="1:1-1:7">Notes<a href="#notes" aria-label="Link to heading \'Notes\'" data-heading-content="Notes" class="anchor"></a></h1>\n' +
		'<p data-sourcepos="3:1-3:67">A paragraph with <strong data-sourcepos="3:18-3:30">bold text</strong> and an <img data-sourcepos="3:39-3:53" src="img.png" alt="alt" /> inline image.</p>\n' +
		'<p data-sourcepos="5:1-5:22"><img data-sourcepos="5:1-5:22" src="pic.png" alt="standalone" /></p>\n' +
		'<p data-sourcepos="7:1-8:15">Trailing prose<br data-sourcepos="7:15-7:15" />\nover two lines.</p>\n',
	FILE_PATH,
	new Set<string>(),
);

const body = parseHtml(RENDERED).body;

/** The first descendant of `root` the shim's `querySelector` can name. */
function pick(selector: string): ShimElement {
	const found = body.querySelector(selector);
	assert.ok(found, `expected the rendered preview to contain ${selector}`);
	return found;
}

/**
 * The first text node under `node` — where the end of a browser selection, and
 * a `MouseEvent.target` inside prose, actually lands. Text nodes have no
 * `closest` of their own, which is the case the lookup has to climb out of.
 */
function firstText(node: ShimNode): ShimNode {
	if (node.nodeType === NODE_TEXT) return node;
	for (const child of node.childNodes) {
		const found = firstText(child);
		if (found.nodeType === NODE_TEXT) return found;
	}
	return node;
}

/* ------------------------------------------------------------------ */
/* what a click resolves to                                            */
/* ------------------------------------------------------------------ */

test('an image inside a paragraph resolves to the image, not to the paragraph', () => {
	// The whole point of #90 for the "or an image" half of the report. The
	// enclosing <p> spans line 3 too here, but the narrowest match is what
	// keeps a multi-line paragraph from selecting all of itself.
	assert.deepEqual(findSourceLineRange(pick('img[alt="alt"]')), {
		startLine: 3,
		endLine: 3,
	});
});

test('a caret inside a block resolves to the whole block', () => {
	// Text nodes have no `closest`; the lookup has to climb to the element.
	// A paragraph is the finest granularity available for plain prose, and it
	// is the right one: the reader asked to edit this paragraph.
	const paragraph = pick('p[data-sourcepos="7:1-8:15"]');
	assert.deepEqual(findSourceLineRange(firstText(paragraph)), { startLine: 7, endLine: 8 });
});

test('an inline node with its own range beats the block around it', () => {
	assert.deepEqual(findSourceLineRange(firstText(pick('strong'))), { startLine: 3, endLine: 3 });
});

test('the fold wrapper processMarkdownHtml inserts does not hide the range', () => {
	// `processMarkdownHtml` re-parents everything after a heading into a
	// `.foldable-content-wrapper` it creates, and that wrapper carries no
	// `data-sourcepos`. The climb has to pass straight through it — this is
	// the same shape of defect #420 fixed for the restore path.
	assert.ok(body.querySelector('.foldable-content-wrapper'), 'expected a fold wrapper');
	assert.deepEqual(findSourceLineRange(pick('img[alt="standalone"]')), {
		startLine: 5,
		endLine: 5,
	});
});

test('anything the app renders around the document resolves to nothing', () => {
	// The front matter panel, the outline, the window chrome. The context menu
	// leaves its "Edit" entry alone rather than jumping somewhere arbitrary.
	assert.equal(findSourceLineRange(null), null);
	assert.equal(findSourceLineRange(parseHtml('<div class="front-matter">x</div>').body), null);
});

/* ------------------------------------------------------------------ */
/* what a selection resolves to                                        */
/* ------------------------------------------------------------------ */

test('a selection spanning several blocks covers all of them', () => {
	const first = findSourceLineRange(firstText(pick('h1')));
	const last = findSourceLineRange(firstText(pick('p[data-sourcepos="7:1-8:15"]')));

	assert.deepEqual(mergeSourceLineRanges(first, last), { startLine: 1, endLine: 8 });
});

test('a backwards selection covers the same lines as a forwards one', () => {
	const a = { startLine: 3, endLine: 3 };
	const b = { startLine: 7, endLine: 8 };

	assert.deepEqual(mergeSourceLineRanges(a, b), mergeSourceLineRanges(b, a));
	assert.deepEqual(mergeSourceLineRanges(b, a), { startLine: 3, endLine: 8 });
});

test('an end that resolves to nothing leaves the other end in charge', () => {
	// Dragging out of the document — into the front matter panel, past the
	// last block — must not throw the whole jump away.
	assert.deepEqual(mergeSourceLineRanges({ startLine: 4, endLine: 6 }, null), {
		startLine: 4,
		endLine: 6,
	});
	assert.deepEqual(mergeSourceLineRanges(null, { startLine: 4, endLine: 6 }), {
		startLine: 4,
		endLine: 6,
	});
	assert.equal(mergeSourceLineRanges(null, null), null);
});

/* ------------------------------------------------------------------ */
/* the jump itself                                                     */
/* ------------------------------------------------------------------ */

test('the outline and the context menu share one line-to-editor jump', () => {
	// `revealHeader` used to reveal and select the line itself. Leaving that
	// copy in place while #90 grew a second one is the drift
	// singleImplementationConvention.test.ts exists to catch: the two would
	// scroll differently, focus differently, and only one of them would clamp.
	const revealHeader = functionSource(editorSource, 'revealHeader');
	assert.match(revealHeader, /revealSourceRange\(lineNumber, lineNumber\)/);
	assert.doesNotMatch(revealHeader, /setSelection\(\{[\s\S]*?startColumn: 1/);
});

test('the jump clamps to the buffer before asking Monaco for a column', () => {
	// `getLineMaxColumn` throws past the end of the model, and the preview can
	// hand over a stale line: its HTML is the render of a buffer that may have
	// been replaced by a shorter one since.
	const reveal = functionSource(editorSource, 'revealSourceRange');
	assert.match(reveal, /lastLine = model\.getLineCount\(\)/);
	assert.match(reveal, /end = Math\.min\([^\n]*lastLine\)/);
	assert.doesNotMatch(reveal, /getLineMaxColumn\((?!end\))/);
});

test('a jump asked for before Monaco has loaded is queued, not dropped', () => {
	// `monaco-editor` is imported dynamically, so the editor exists several
	// frames after the component does — and the preview calls in immediately
	// after flipping into edit mode.
	const reveal = functionSource(editorSource, 'revealSourceRange');
	assert.match(reveal, /if \(!editorReady \|\| !editor\) \{\s*\n\s*pendingReveal = \{ startLine, endLine \};/);

	// Spent after the view-state / anchor-line restore, so an explicit "edit
	// this fragment" wins over the position the tab was left at.
	const afterReady = sliceFrom(editorSource, 'editorReady = true;');
	assert.ok(
		afterReady.indexOf('pendingReveal') < afterReady.indexOf('return () => {'),
		'the queued jump must be spent inside onMount, before the teardown closure',
	);
});

/* ------------------------------------------------------------------ */
/* the context menu wiring                                             */
/* ------------------------------------------------------------------ */

test('the Edit entry resolves its target while the selection still exists', () => {
	// Resolving inside the `onClick` would read the selection AFTER the reader
	// clicked a menu item, and a click is how a selection goes away.
	const handler = functionSource(viewerSource, 'handleContextMenu');
	assert.match(handler, /const editSourceTarget = getContextMenuSourceRange\(e\);/);
	assert.match(handler, /t\('menu\.edit', uiLanguage\), onClick: \(\) => editSourceRange\(editSourceTarget\)/);
	assert.doesNotMatch(handler, /onClick: \(\) => toggleEdit\(\)/);
});

test('Edit with a target never leaves edit mode', () => {
	// In split view the editor is already on screen, and "edit this fragment"
	// is the one thing that cannot mean "close the editor".
	const edit = functionSource(viewerSource, 'editSourceRange');
	assert.match(edit, /if \(!isEditing\) await toggleEdit\(\);/);
	// And a read that failed leaves the tab in reading mode — arming the jump
	// anyway would fire it at whatever document is edited next.
	assert.match(edit, /tabManager\.activeTab\?\.isEditing/);
});

test('the target is a source range and never a column', () => {
	// `parseSourceposLineRange` is the only reader of the attribute, and it
	// keeps line numbers only. Nothing in the preview may take the `:col` half
	// and aim Monaco with it — see the header of this file for why.
	const resolve = functionSource(viewerSource, 'getContextMenuSourceRange');
	assert.match(resolve, /findSourceLineRange\(/);
	assert.doesNotMatch(resolve, /startColumn|endColumn/);
});
