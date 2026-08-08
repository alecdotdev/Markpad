import assert from 'node:assert/strict';
import test from 'node:test';

import { functionSource, readSource, sliceBetween } from './sourceTree.js';

// #549. Two copy entry points read a DOM selection rather than the editor's, so
// #548's one-implementation-per-operation rule never reached them: ⌘C in the
// preview, and Edit ▸ Copy in the menu bar, which is a `PredefinedMenuItem::copy`
// and asks the webview to perform its own copy.
//
// Both landed on plain text anyway, but by accident. WebKit's copy writes a
// WebArchive beside the text, and the only reason a shipped build has none is
// that `LegacyWebArchive` skips its subresource sweep for origins outside the
// http family — and `tauri://localhost` is outside it. Measured, same selection,
// same binary:
//
//   tauri build --debug (tauri://localhost)   utf8 70
//   tauri dev           (http://localhost)    weba 19,081,919 + RTF + HTML
//
// Cancelling the copy event is checked first (`Editor::copy` → `tryDHTMLCopy`),
// before any of that is built, and it is checked whatever the origin. So these
// assertions hold two things: that the plain-text result is ours rather than the
// scheme's, and that nobody turns this into a rich copy — which would put
// flavours into shipped builds that have never been there.

const viewer = readSource(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url));
const handler = functionSource(viewer, 'handleCopyPlainText');

test('the document-level copy handler is attached', () => {
	// Document level rather than the preview's `<article>`: `styles.css` puts
	// `user-select: none` on the app root, so the only selectable surfaces are
	// the preview and the update dialog's release notes (#532) — and both take
	// the same native path.
	const svelteDocument = sliceBetween(viewer, '<svelte:document', '/>');
	assert.match(svelteDocument, /oncopy=\{handleCopyPlainText\}/);
});

test('the copy handler writes plain text and cancels the native copy', () => {
	assert.match(handler, /setData\(\s*'text\/plain'/);
	// Without this the native copy still runs and still builds the archive.
	assert.match(handler, /preventDefault\(\)/);
});

test('the copy handler writes no rich flavour', () => {
	// The whole point is that every route puts the same plain text on the
	// clipboard. A `text/html` here would add formatting to shipped builds that
	// they have never produced, and would be a product decision rather than this
	// fix — see #549 for why "plain or rich" is a separate question.
	assert.doesNotMatch(handler, /text\/html/);
	assert.doesNotMatch(handler, /text\/rtf/i);
});

test('a selection inside a form control is left to the platform', () => {
	// Mirrors WebKit's own carve-out in `Editor::performCutOrCopy`: such a
	// selection already gets plain text and no archive, and `getSelection()`
	// cannot read it — cancelling here would copy an empty string. Monaco takes
	// input through a hidden textarea and is covered by the same test, which is
	// what keeps the editor on its own Rust path (#548).
	assert.match(handler, /document\.activeElement/);
	assert.match(handler, /HTMLInputElement/);
	assert.match(handler, /HTMLTextAreaElement/);
	const carveOut = handler.indexOf('HTMLTextAreaElement');
	const write = handler.indexOf('setData');
	assert.ok(carveOut !== -1 && write !== -1 && carveOut < write, 'the carve-out must return before the write');
});

test('a collapsed selection is not copied', () => {
	// Edit ▸ Copy is enabled with nothing selected; writing '' would clear the
	// clipboard instead of leaving it alone.
	assert.match(handler, /isCollapsed/);
});
