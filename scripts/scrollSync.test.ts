import assert from 'node:assert/strict';
import test from 'node:test';

import {
	getScrollSyncPositionFromPixels,
	getScrollTopForSyncPosition,
	type ScrollSyncPosition,
} from '../src/lib/utils/scrollSync.js';

// These tests import and run the mapping. The previous scroll-sync tests read
// Editor.svelte as text, so the defect that set the sync threshold to a value
// which disabled sync outright left all 23 of their assertions green (#433).
// Every assertion below is on a returned number, so an arithmetic change that
// stops the panes tracking each other fails here.

type Pane = { scrollMax: number; frontMatterEnd: number };

// The same document in the two panes. Front matter is ordinary text in the
// editor and a fixed-height panel in the preview, so it takes 20% of the
// editor's scroll range and 10% of the preview's. Those proportions differing
// is the entire reason the mapping carries a section rather than one ratio.
const EDITOR: Pane = { scrollMax: 1000, frontMatterEnd: 200 };
const PREVIEW: Pane = { scrollMax: 600, frontMatterEnd: 60 };

function positionIn(pane: Pane, scrollTop: number): ScrollSyncPosition {
	return getScrollSyncPositionFromPixels(scrollTop, pane.scrollMax, pane.frontMatterEnd);
}

function scrollTopIn(pane: Pane, position: ScrollSyncPosition): number {
	return getScrollTopForSyncPosition(position, pane.scrollMax, pane.frontMatterEnd);
}

// What split view actually does on every scroll event: read a position out of
// the pane the user moved, and turn it into pixels for the other pane.
function across(from: Pane, to: Pane, scrollTop: number): number {
	return scrollTopIn(to, positionIn(from, scrollTop));
}

function assertClose(actual: number, expected: number, what: string) {
	assert.ok(
		Math.abs(actual - expected) < 1e-9,
		`${what}: expected ${expected}, got ${actual}`,
	);
}

test('the front-matter boundary in one pane lands on the boundary in the other', () => {
	// The measurement the whole design exists for. A single global
	// scrollTop/scrollMax ratio would put the editor's boundary at
	// (200 / 1000) * 600 = 120px in the preview — twice past the end of the
	// preview's own front matter, i.e. already scrolled into the body.
	//
	// That 120 used to be asserted. It is arithmetic over the two fixture
	// constants above and never reaches `src/`, so it belongs in this comment
	// and not in an assert; the two assertions below are the claim, and they
	// are on numbers the mapping returned.
	assert.equal(across(EDITOR, PREVIEW, 200), 60, 'editor boundary must land on the preview boundary');
	assert.equal(across(PREVIEW, EDITOR, 60), 200, 'preview boundary must land on the editor boundary');
});

test('front matter maps onto front matter by its own share of the section', () => {
	assert.deepEqual(positionIn(EDITOR, 100), { section: 'frontmatter', ratio: 0.5 });
	assert.equal(across(EDITOR, PREVIEW, 100), 30);
	assert.equal(across(EDITOR, PREVIEW, 50), 15);
	assert.equal(across(PREVIEW, EDITOR, 30), 100);
});

test('body maps onto body by its share of the body range, not of the whole pane', () => {
	// Half way down the editor's body is (600 - 200) / (1000 - 200).
	assert.deepEqual(positionIn(EDITOR, 600), { section: 'body', ratio: 0.5 });
	// ...which is 60 + (600 - 60) * 0.5 in the preview, not 600/1000 * 600 = 360.
	assert.equal(across(EDITOR, PREVIEW, 600), 330);
	assert.equal(across(PREVIEW, EDITOR, 330), 600);
});

test('top and bottom are fixed points of the mapping', () => {
	assert.equal(across(EDITOR, PREVIEW, 0), 0);
	assert.equal(across(EDITOR, PREVIEW, EDITOR.scrollMax), PREVIEW.scrollMax);
	assert.equal(across(PREVIEW, EDITOR, 0), 0);
	assert.equal(across(PREVIEW, EDITOR, PREVIEW.scrollMax), EDITOR.scrollMax);
});

test('scrolling one pane down always moves the other pane down', () => {
	// The shape of the defect that went undetected last time: sync that reports
	// a constant, so the other pane never follows. An inverted ratio fails here
	// too — this is the only property that covers the whole range at once.
	const sweep = [0, 1, 50, 100, 150, 199, 200, 201, 400, 600, 800, 999, 1000];
	const mapped = sweep.map((scrollTop) => across(EDITOR, PREVIEW, scrollTop));

	for (let i = 1; i < sweep.length; i += 1) {
		assert.ok(
			mapped[i] > mapped[i - 1],
			`editor ${sweep[i - 1]} -> ${sweep[i]} must move the preview forward, got ${mapped[i - 1]} -> ${mapped[i]}`,
		);
	}
});

test('a position round-trips through pixels in the pane it came from', () => {
	for (const pane of [EDITOR, PREVIEW]) {
		const sweep = [0, 1, pane.frontMatterEnd - 1, pane.frontMatterEnd, pane.frontMatterEnd + 1, pane.scrollMax / 2, pane.scrollMax - 1, pane.scrollMax];

		for (const scrollTop of sweep) {
			const back = scrollTopIn(pane, positionIn(pane, scrollTop));
			assertClose(back, scrollTop, `scrollTop ${scrollTop} in pane max=${pane.scrollMax} fm=${pane.frontMatterEnd}`);

			// ...and the position recovered from those pixels is the same position.
			assert.deepEqual(positionIn(pane, back), positionIn(pane, scrollTop));
		}
	}
});

test('the boundary pixel belongs to the body, not to the front matter', () => {
	// Both labels put the same pixel on screen (frontmatter at ratio 1 and body
	// at ratio 0 both resolve to frontMatterEnd in every pane), so this can only
	// be asserted on the label. It is what makes the `<` in the section test an
	// invariant rather than an arbitrary choice: scrolling one pixel further
	// must not jump back to a ratio of 1.
	assert.deepEqual(positionIn(EDITOR, 199), { section: 'frontmatter', ratio: 0.995 });
	assert.equal(positionIn(EDITOR, 200).section, 'body');
	assert.equal(positionIn(EDITOR, 200).ratio, 0);
	assert.equal(positionIn(EDITOR, 201).section, 'body');

	assert.equal(scrollTopIn(EDITOR, { section: 'frontmatter', ratio: 1 }), EDITOR.frontMatterEnd);
	assert.equal(scrollTopIn(EDITOR, { section: 'body', ratio: 0 }), EDITOR.frontMatterEnd);
});

test('a document with no front matter is one body range', () => {
	const plain: Pane = { scrollMax: 800, frontMatterEnd: 0 };

	assert.deepEqual(positionIn(plain, 0), { section: 'body', ratio: 0 });
	assert.deepEqual(positionIn(plain, 200), { section: 'body', ratio: 0.25 });
	assert.deepEqual(positionIn(plain, 800), { section: 'body', ratio: 1 });
	assert.equal(scrollTopIn(plain, { section: 'body', ratio: 0.25 }), 200);

	// A front-matter position arriving from a pane that has one scrolls this
	// pane to the top, because its front matter occupies no pixels.
	assert.equal(scrollTopIn(plain, { section: 'frontmatter', ratio: 1 }), 0);
	assert.equal(across(EDITOR, plain, 100), 0);
});

test('a document shorter than the viewport has no scroll range and no division by zero', () => {
	const short: Pane = { scrollMax: 0, frontMatterEnd: 0 };

	assert.deepEqual(positionIn(short, 0), { section: 'body', ratio: 0 });
	assert.deepEqual(positionIn(short, 500), { section: 'body', ratio: 0 });
	assert.equal(scrollTopIn(short, { section: 'body', ratio: 1 }), 0);
	assert.equal(scrollTopIn(short, { section: 'frontmatter', ratio: 1 }), 0);

	// scrollMax 0 with a measured front matter height: the height clamps away
	// with the range, rather than dividing by a range that is not there.
	const shortWithFrontMatter: Pane = { scrollMax: 0, frontMatterEnd: 120 };
	assert.deepEqual(positionIn(shortWithFrontMatter, 60), { section: 'body', ratio: 0 });
	assert.equal(scrollTopIn(shortWithFrontMatter, { section: 'frontmatter', ratio: 0.5 }), 0);
});

test('front matter taller than the scroll range leaves no body range', () => {
	// Reachable: a long YAML block in a short document. frontMatterEnd clamps to
	// scrollMax, so the body range is exactly zero.
	const allFrontMatter: Pane = { scrollMax: 100, frontMatterEnd: 400 };

	assert.deepEqual(positionIn(allFrontMatter, 50), { section: 'frontmatter', ratio: 0.5 });
	assert.deepEqual(positionIn(allFrontMatter, 100), { section: 'body', ratio: 0 });
	assert.equal(scrollTopIn(allFrontMatter, { section: 'frontmatter', ratio: 0.5 }), 50);

	// A zero-width body must not swallow the bottom of the pane: a body position
	// arriving from the other pane still lands at the end of the scroll range.
	assert.equal(scrollTopIn(allFrontMatter, { section: 'body', ratio: 0 }), 100);
	assert.equal(scrollTopIn(allFrontMatter, { section: 'body', ratio: 1 }), 100);
	assert.equal(across(EDITOR, allFrontMatter, 1000), 100);
});

test('out-of-range pixels clamp instead of escaping the pane', () => {
	assert.deepEqual(positionIn(EDITOR, -500), { section: 'frontmatter', ratio: 0 });
	assert.deepEqual(positionIn(EDITOR, 5000), { section: 'body', ratio: 1 });
	assert.equal(across(EDITOR, PREVIEW, -500), 0);
	assert.equal(across(EDITOR, PREVIEW, 5000), PREVIEW.scrollMax);

	// A negative scrollMax or frontMatterEnd is floored at 0 rather than
	// inverting the arithmetic.
	assert.deepEqual(getScrollSyncPositionFromPixels(100, -1000, 200), { section: 'body', ratio: 0 });
	assert.deepEqual(getScrollSyncPositionFromPixels(100, 1000, -200), { section: 'body', ratio: 0.1 });
	assert.equal(getScrollTopForSyncPosition({ section: 'body', ratio: 1 }, -1000, 200), 0);
	assert.equal(getScrollTopForSyncPosition({ section: 'body', ratio: 1 }, 1000, -200), 1000);
});

test('a non-finite measurement or ratio never reaches setScrollTop', () => {
	// Monaco and the DOM both return measurements that can be NaN mid-layout,
	// and the position travels across a component boundary before it is used.
	assert.deepEqual(positionIn(EDITOR, Number.NaN), { section: 'body', ratio: 0 });
	assert.deepEqual(positionIn(EDITOR, Number.POSITIVE_INFINITY), { section: 'body', ratio: 1 });

	for (const ratio of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 2]) {
		for (const section of ['frontmatter', 'body'] as const) {
			const scrollTop = scrollTopIn(PREVIEW, { section, ratio });
			assert.ok(
				Number.isFinite(scrollTop) && scrollTop >= 0 && scrollTop <= PREVIEW.scrollMax,
				`ratio ${ratio} in ${section} produced ${scrollTop}`,
			);
		}
	}

	// Out-of-range finite ratios clamp to the ends of their section; non-finite
	// ones are rejected outright and read as 0, not as the nearest end.
	assert.equal(scrollTopIn(PREVIEW, { section: 'body', ratio: 2 }), PREVIEW.scrollMax);
	assert.equal(scrollTopIn(PREVIEW, { section: 'body', ratio: Number.POSITIVE_INFINITY }), PREVIEW.frontMatterEnd);
});
