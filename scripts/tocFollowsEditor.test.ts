/**
 * #169: the outline highlights the heading you are reading, but only ever
 * answered to the PREVIEW.
 *
 * `Toc.svelte` decided by rendered box — `querySelector` each visible entry
 * out of the preview and measure it against the container, per entry, per
 * scroll event. That question has no answer while the editor is the pane being
 * scrolled: in editor-only mode the preview never scrolls, and in split view
 * it moves only while scroll sync is on. So the outline sat still exactly
 * where the reporter said it did.
 *
 * A SOURCE LINE is something both panes can produce — the editor sends one on
 * every scroll, and the preview already computes one for the tab's reading
 * position — so the rule is now one comparison over a list, fed by either.
 * That the two panes share it is the property worth having: in split view with
 * sync on both are live at once, and two rules could disagree as the panes
 * settle and flicker the highlight between two entries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource, sliceBetween } from './sourceTree.js';

import { activeTocIdForLine, sourceLineOf } from '../src/lib/utils/tocFollow.js';

const tocSource = readSource(new URL('../src/lib/components/Toc.svelte', import.meta.url));
const viewerSource = readSource(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url));
const settingsSource = readSource(new URL('../src/lib/stores/settings.svelte.ts', import.meta.url));
const settingsComponentSource = readSource(new URL('../src/lib/components/Settings.svelte', import.meta.url));

/** An outline of a document whose headings are 20 source lines apart. */
const OUTLINE = [
	{ id: 'intro', line: 1 },
	{ id: 'setup', line: 21 },
	{ id: 'a-block-anchor', line: null },
	{ id: 'usage', line: 41 },
	{ id: 'api', line: 61 },
];

test('the active entry is the last heading at or above the editor position', () => {
	assert.equal(activeTocIdForLine(OUTLINE, 1), 'intro');
	assert.equal(activeTocIdForLine(OUTLINE, 20), 'intro');
	assert.equal(activeTocIdForLine(OUTLINE, 21), 'setup');
	assert.equal(activeTocIdForLine(OUTLINE, 40.7), 'setup');
	assert.equal(activeTocIdForLine(OUTLINE, 41), 'usage');
	assert.equal(activeTocIdForLine(OUTLINE, 4000), 'api');
});

test('a position above every heading takes the first entry, as the preview does', () => {
	// `handleScroll` seeds `currentActive` with `visibleItems[0]` before its
	// loop, so front matter — or anything above the first heading — leaves the
	// first entry highlighted. Answering `null` here instead would blank the
	// outline on the way past the top of a document scrolled in the editor.
	assert.equal(activeTocIdForLine([{ id: 'later', line: 12 }], 3), 'later');
});

test('an entry with no source range never becomes active, and never hides one that has', () => {
	// Block anchors (`^id`) are in the outline and carry no range of their own.
	// A `null` must not be read as line 0 and swallow every position after it.
	assert.equal(activeTocIdForLine(OUTLINE, 45), 'usage');
	assert.equal(activeTocIdForLine([{ id: 'block', line: null }], 900), 'block');
});

test('nothing to follow yields nothing, rather than a stale entry', () => {
	assert.equal(activeTocIdForLine([], 12), null);
	assert.equal(activeTocIdForLine(OUTLINE, Number.NaN), null);
});

test('the start line comes from the sourcepos comrak wrote, or nothing', () => {
	assert.equal(sourceLineOf('42:1-44:9'), 42);
	assert.equal(sourceLineOf('7:1-7:12'), 7);
	assert.equal(sourceLineOf(undefined), null);
	assert.equal(sourceLineOf(''), null);
	assert.equal(sourceLineOf('0:1-0:1'), null);
	assert.equal(sourceLineOf('nonsense'), null);
});

/* --------------------------------------------------------------- wiring */

test('the outline carries a source line for every entry it builds', () => {
	// Both kinds — headings and block anchors — or the mapping above is asked
	// about entries it cannot place.
	assert.match(tocSource, /isBlock: false, line: sourceLineOf\(h\.dataset\.sourcepos\)/);
	assert.match(tocSource, /isBlock: true, line: sourceLineOf\(el\.dataset\.sourcepos\)/);
	// The fingerprint decides whether a re-render replaces the items. An edit
	// that only moves a heading changes nothing else about it, so without the
	// line in there the outline would keep answering with the old positions.
	assert.match(tocSource, /newFingerprint = result\.map\(i => `\$\{i\.id\}-\$\{i\.text\}-\$\{i\.level\}-\$\{i\.line\}`\)/);
});

test('a click still wins over the editor, as it does over the preview', () => {
	// `clickLock` holds the entry the user picked until the jump's smooth scroll
	// settles. The preview's handler returns early on it; so must this one, or
	// clicking an entry would highlight it and then lose it to the scroll the
	// click itself caused.
	assert.match(tocSource, /const line = activeLine;\s*\n\s*if \(line === null \|\| clickLock\) return;/);
});

test('the editor position reaches the outline whether or not scroll sync is on', () => {
	// The line is recorded before the sync check, not inside it: following the
	// editor is not the same feature as moving the preview, and #169 asks for it
	// in editor-only mode, where there is no preview to move.
	assert.match(
		viewerSource,
		/function handleEditorScrollSync\(position: ScrollSyncPosition\) \{\s*\n\s*if \(position\.line !== undefined\) tocActiveLine = position\.line;/,
	);
});

test('the preview feeds the same state, off the line it already measures', () => {
	// `getPreviewScrollAnchor` is computed on every preview scroll for the
	// tab's reading position. Taking the outline's answer from it is what makes
	// this one rule rather than two — and it costs nothing, because the descent
	// it does was already happening on that event.
	const handler = sliceBetween(viewerSource, 'function handleScroll(e: Event)', '\n\tfunction ');
	assert.match(handler, /const anchorLine = getPreviewScrollAnchor\(target\);/);
	assert.match(handler, /tocActiveLine = anchorLine;/);
	// One input, from whichever pane moved last.
	assert.match(viewerSource, /activeLine=\{tocActiveLine\}/);
});

test('the outline no longer measures the preview to decide', () => {
	// The loop this replaces did a `querySelector` and a `getBoundingClientRect`
	// per visible entry on every scroll event, and could only ever answer for
	// one of the two panes.
	const handler = sliceBetween(tocSource, 'function handleScroll()', '\n\tfunction ');
	assert.doesNotMatch(handler, /getBoundingClientRect/);
	assert.doesNotMatch(handler, /querySelector/);
	// What it still does: a click leaves a highlight on its target, and the
	// next scroll takes it off.
	assert.match(handler, /activeTargetEl\.classList\.remove\('toc-target-active'\)/);
});

test('there is no preference for it, because the preview never had one', () => {
	// The outline has always followed the preview unconditionally. This is the
	// same feature answering for the other pane, so a switch would have made
	// half of one behaviour optional and left the reader to work out which half.
	assert.doesNotMatch(settingsSource, /tocFollowsEditor/);
	assert.doesNotMatch(settingsComponentSource, /tocFollowsEditor/);
});

test('the current entry is centred in the outline, not merely kept on screen', () => {
	// `block: 'nearest'` scrolls the least it can: the highlight walked down to
	// the last visible row and stayed pinned there, and what came next was
	// never shown. Both callers share this one function, so the preview gets it
	// too.
	assert.match(tocSource, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
	assert.doesNotMatch(tocSource, /scrollIntoView\(\{ block: 'nearest'/);
});
