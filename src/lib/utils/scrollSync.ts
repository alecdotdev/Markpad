// Split-view scroll sync maps a position in one pane onto pixels in the other.
//
// The two panes are not proportional to each other. Front matter renders as a
// fixed-height panel in the preview and as ordinary text lines in the editor, so
// the same document gives the two panes different total scroll ranges *and* a
// different share of that range spent on front matter. A single global
// scrollTop/scrollMax ratio therefore drifts: at the moment the editor finishes
// scrolling past its front matter, the naive ratio has already carried the
// preview well into the body.
//
// The fix is to split the range in two at `frontMatterEnd` and carry a
// (section, ratio) pair between the panes instead of a raw ratio. Front matter
// maps onto front matter and body onto body, whatever each pane's proportions
// are, and the boundary maps onto the boundary exactly.
//
// Both functions are pure arithmetic. They lived, byte for byte, in both
// Editor.svelte and MarkdownViewer.svelte; neither copy could be imported by a
// test, because `node --test` cannot load a `.svelte` file. Here they are
// covered for real by scripts/scrollSync.test.ts.

export type ScrollSyncPosition = {
	section: 'frontmatter' | 'body';
	ratio: number;
};

function clampScrollRatio(value: number) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

export function getScrollSyncPositionFromPixels(scrollTop: number, scrollMax: number, frontMatterEnd: number): ScrollSyncPosition {
	const safeMax = Math.max(0, scrollMax);
	const safeFrontMatterEnd = Math.max(0, Math.min(safeMax, frontMatterEnd));
	const safeScrollTop = Math.max(0, Math.min(safeMax, scrollTop));

	if (safeFrontMatterEnd > 0 && safeScrollTop < safeFrontMatterEnd) {
		return {
			section: 'frontmatter',
			ratio: clampScrollRatio(safeScrollTop / safeFrontMatterEnd),
		};
	}

	const bodyRange = Math.max(0, safeMax - safeFrontMatterEnd);
	return {
		section: 'body',
		ratio: bodyRange > 0 ? clampScrollRatio((safeScrollTop - safeFrontMatterEnd) / bodyRange) : 0,
	};
}

export function getScrollTopForSyncPosition(position: ScrollSyncPosition, scrollMax: number, frontMatterEnd: number) {
	const safeMax = Math.max(0, scrollMax);
	const safeFrontMatterEnd = Math.max(0, Math.min(safeMax, frontMatterEnd));
	const ratio = clampScrollRatio(position.ratio);

	if (position.section === 'frontmatter') {
		return safeFrontMatterEnd * ratio;
	}

	const bodyRange = Math.max(0, safeMax - safeFrontMatterEnd);
	return safeFrontMatterEnd + bodyRange * ratio;
}
