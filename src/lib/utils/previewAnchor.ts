/**
 * Resolving a source line to a rendered preview element, and back.
 *
 * Two features share this. Scrolling the preview saves a source line
 * (`tab.anchorLine`, produced by `getPreviewScrollAnchor`) and re-activating the
 * tab has to turn that line back into a scroll offset; split-view scroll sync
 * has to turn the preview's scroll offset into a source line for the editor and
 * a source line from the editor back into a preview offset. Both directions key
 * off the `data-sourcepos` attributes comrak writes onto the rendered blocks.
 *
 * The one thing that makes this non-trivial: `processMarkdownHtml` re-parents
 * everything that follows a heading into a `.foldable-content-wrapper` it
 * creates itself, and that wrapper has no `data-sourcepos` of its own. After
 * that pass the only top-level elements still carrying a source range are the
 * shallowest headings in the document, so a scan of `body.children` can only
 * ever match an anchor that landed exactly on one of those heading lines.
 *
 * Every lookup here therefore descends. It treats an element without a source
 * range as a transparent container whose span is derived from its first and
 * last annotated descendants, which lets it skip a whole section in one
 * comparison instead of visiting every annotated element in the document. The
 * work is proportional to the number of siblings along the path to the match
 * (plus the fold depth), not to the document size. That matters more than it
 * used to: scroll sync runs a lookup on every scroll event, where the flat
 * `querySelectorAll('[data-sourcepos]')` scan it replaced cost 8.3ms per event
 * on a 13,000-line document (measured in Chrome over this pipeline's output;
 * the descent, with the memos below, is 0.9ms on the same document and 0.2ms
 * on a 1,700-line one).
 */

/** Inclusive source line range, as written in `data-sourcepos`. */
type LineRange = {
	startLine: number;
	endLine: number;
};

/**
 * The subset of `Element` this module reads. Declaring it structurally keeps
 * the resolution testable against the render-protocol DOM shim, which is what
 * lets the hit rate be measured over real `processMarkdownHtml` output.
 */
export type AnchorNode = {
	readonly nodeType: number;
	readonly tagName?: string;
	readonly childNodes: Iterable<AnchorNode>;
	getAttribute?(name: string): string | null;
	readonly classList?: { contains(token: string): boolean };
};

type AnchorMatch = LineRange & {
	element: AnchorNode;
};

/**
 * Where an element sits in the preview's scroll content, in the same space as
 * the container's `scrollTop`. In the browser this is `offsetTop` /
 * `offsetHeight`, which is what every other measurement in this file assumes.
 */
export type AnchorBox = {
	top: number;
	height: number;
};

type MeasureAnchorBox = (node: AnchorNode) => AnchorBox;

const ELEMENT_NODE = 1;

/**
 * Elements comrak stamps with a `data-sourcepos` that generate no CSS box the
 * `offsetTop` / `offsetHeight` API can report. `render.hardbreaks` is on, so
 * every soft-wrapped line of prose ends in one of these, and resolving an
 * anchor to one hands the restore `offsetTop = 0, offsetHeight = 0` — which
 * scrolls the preview to the top of the document instead of to the line.
 */
const BOXLESS_TAGS = new Set(['BR', 'WBR']);

function isAnchorable(node: AnchorNode): boolean {
	return !BOXLESS_TAGS.has(node.tagName ?? '');
}

/**
 * Distance from the top of the viewport at which the anchor line is pinned.
 * Capture and restore have to agree on it or every round trip drifts by the
 * difference.
 */
export const PREVIEW_ANCHOR_OFFSET = 60;

export function parseSourceposLineRange(sourcepos: string | null | undefined): LineRange | null {
	if (!sourcepos) return null;

	const [start, end] = sourcepos.split('-');
	const startLine = parseInt(start?.split(':')[0] ?? '', 10);
	const endLine = parseInt(end?.split(':')[0] ?? '', 10);

	if (Number.isNaN(startLine) || Number.isNaN(endLine)) return null;
	return { startLine, endLine };
}

function elementChildren(node: AnchorNode): AnchorNode[] {
	const out: AnchorNode[] = [];
	for (const child of node.childNodes) {
		if (child.nodeType === ELEMENT_NODE && isAnchorable(child)) out.push(child);
	}
	return out;
}

/*
 * Both lookups below are memoised on the node, and both memos are WeakMaps
 * keyed by the element itself.
 *
 * This is what makes the mapping affordable on a scroll event. A source range
 * is parsed out of a string and a container's span is derived by walking to its
 * first and last annotated descendants; without a memo both are recomputed for
 * every candidate sibling on every call, and on a 13,000-line document that is
 * ~6ms per mapping — measured, in Chrome, over this pipeline's own output.
 *
 * WHAT INVALIDATES THEM: nothing, explicitly. The answer for a node is a
 * function of that node's own attribute and of its subtree's annotated blocks,
 * neither of which is edited in place — the preview is rebuilt wholesale by
 * `bind:innerHTML` on every render pass, so a changed document is a new set of
 * nodes, and the entries describing the old ones are collected with them.
 * Folding, task checkboxes and rich-content rendering all leave the annotated
 * blocks and their ranges exactly where they were.
 */
const ownRangeCache = new WeakMap<object, LineRange | null>();
const spanCache = new WeakMap<object, LineRange | null>();

function ownRange(node: AnchorNode): LineRange | null {
	const cached = ownRangeCache.get(node as object);
	if (cached !== undefined) return cached;

	const range = parseSourceposLineRange(node.getAttribute?.('data-sourcepos'));
	ownRangeCache.set(node as object, range);
	return range;
}

/**
 * A collapsed fold (or callout) keeps its children in the layout tree — the
 * wrapper is `height: 0; overflow: hidden`, not `display: none` — so those
 * children still report offsets, and those offsets point at where the content
 * *would* be rather than where it is. Descent stops at such a container and
 * uses the container itself, which sits at the right place on screen.
 */
function isCollapsedContainer(node: AnchorNode): boolean {
	return node.classList?.contains('is-collapsed') === true;
}

/**
 * The span an element covers: its own range, or — for a container the render
 * pipeline created — the range from its first to its last annotated descendant.
 */
function resolveSpan(node: AnchorNode): LineRange | null {
	const cached = spanCache.get(node as object);
	if (cached !== undefined) return cached;

	const span = computeSpan(node);
	spanCache.set(node as object, span);
	return span;
}

function computeSpan(node: AnchorNode): LineRange | null {
	const own = ownRange(node);
	if (own) return own;

	const children = elementChildren(node);

	let first: LineRange | null = null;
	for (const child of children) {
		first = resolveSpan(child);
		if (first) break;
	}
	if (!first) return null;

	let last: LineRange | null = null;
	for (let index = children.length - 1; index >= 0; index -= 1) {
		last = resolveSpan(children[index]);
		if (last) break;
	}

	return { startLine: first.startLine, endLine: Math.max(first.endLine, last?.endLine ?? first.endLine) };
}

/**
 * How far a candidate element is from what the caller is looking for: `0` when
 * it is the thing, otherwise the size of the gap. `NaN` disqualifies a
 * candidate outright, which is how an element the browser could not measure
 * drops out (`NaN < best` is false).
 *
 * One descent serves three lookups — an exact line, the nearest line, and a
 * pixel offset — so the element the two sync directions pick is chosen by the
 * same walk over the same tree with the same skip rules. That is what makes
 * line -> offset -> line an identity rather than an approximation: if the two
 * directions descended differently they could land on an ancestor one way and
 * a descendant the other, and the round trip would drift by the difference.
 */
type AnchorDistance = (span: LineRange, node: AnchorNode) => number;

function lineDistance(span: LineRange, line: number): number {
	if (line < span.startLine) return span.startLine - line;
	if (line > span.endLine) return line - span.endLine;
	return 0;
}

/**
 * A block owns the pixels `[top, top + height)` — half open at the bottom.
 *
 * Adjacent blocks touch: margins collapse, and one block's bottom edge is the
 * next one's top. If both claim that pixel the earlier one wins, because the
 * descent stops at the first candidate whose distance is zero. That is a
 * feedback loop rather than an off-by-one: a line resolved back to a pixel
 * lands on the TOP edge of its block, which the block ABOVE then claims, so
 * every echo between the panes walks the reader one block up the document.
 * (Observed in Chrome over this pipeline's own output; the DOM shim has no
 * layout, so its blocks never touched and the loop was invisible there.)
 *
 * A block whose bottom edge is exactly the offset therefore reports the
 * smallest positive distance instead of zero: still the nearest thing when
 * nothing contains the offset, but beaten by whatever does.
 */
function boxDistance(box: AnchorBox, offset: number): number {
	if (!Number.isFinite(box.top) || !Number.isFinite(box.height)) return Number.NaN;
	if (offset < box.top) return box.top - offset;

	const below = offset - (box.top + box.height);
	if (below < 0) return 0;
	return below > 0 ? below : Number.EPSILON;
}

/**
 * Descend to the narrowest annotated element `distanceOf` says is closest.
 *
 * `strict` is the difference between "which block owns this line" (a line
 * between two blocks owns nothing, and the caller has a fallback for that) and
 * "which block is this scroll position in" — where returning nothing would put
 * a gap between two blocks, or the padding under the last one, back on the
 * proportional mapping and make the panes jump every time the reader crossed
 * one.
 */
function descend(
	node: AnchorNode,
	inherited: AnchorMatch | null,
	distanceOf: AnchorDistance,
	strict: boolean,
): AnchorMatch | null {
	let chosen: AnchorNode | null = null;
	let chosenSpan: LineRange | null = null;
	let chosenOwn: LineRange | null = null;
	let best = Number.POSITIVE_INFINITY;

	for (const child of elementChildren(node)) {
		const own = ownRange(child);
		const span = own ?? resolveSpan(child);
		// No annotated descendant: the front-matter panel, the table of contents,
		// anything else the app renders around the document. Nothing here maps to
		// a source line, so it must not swallow the offset.
		if (!span) continue;

		const distance = distanceOf(span, child);
		if (!(distance < best)) continue;

		best = distance;
		chosen = child;
		chosenSpan = span;
		chosenOwn = own;
		if (distance === 0) break;
	}

	if (!chosen || !chosenSpan) return null;
	if (strict && best > 0) return null;

	const carried: AnchorMatch | null = chosenOwn ? { element: chosen, ...chosenOwn } : inherited;
	const fallback: AnchorMatch = carried ?? { element: chosen, ...chosenSpan };

	if (!chosenOwn && isCollapsedContainer(chosen)) return { element: chosen, ...chosenSpan };

	return descend(chosen, carried, distanceOf, strict) ?? fallback;
}

/**
 * The narrowest visible element whose source range contains `line`, or `null`
 * when the line falls outside every rendered block (a stale anchor, or a blank
 * line between blocks) and the caller should fall back to a proportional
 * restore.
 */
export function findAnchorElement(root: AnchorNode, line: number): AnchorMatch | null {
	if (!Number.isFinite(line) || line <= 0) return null;
	return descend(root, null, (span) => lineDistance(span, line), true);
}

/**
 * As `findAnchorElement`, but a line no block owns resolves to the nearest
 * block instead of to nothing. Only the scroll-sync mapping wants this: the
 * blank lines between blocks are a third of a typical document, and falling
 * back to the proportional mapping on every one of them would make the paired
 * pane jump back and forth as the reader scrolled.
 */
function findNearestAnchorElement(root: AnchorNode, line: number): AnchorMatch | null {
	if (!Number.isFinite(line) || line <= 0) return null;
	return descend(root, null, (span) => lineDistance(span, line), false);
}

/**
 * The narrowest annotated element whose box covers `offset`, or the nearest one
 * when the offset falls in the margin between two blocks or in the padding
 * below the last one.
 *
 * `measure` supplies the layout — `offsetTop` / `offsetHeight` in the browser.
 * It is a parameter because this module is otherwise pure enough to run against
 * the render-protocol DOM shim, and that shim has no layout at all; injecting
 * one is what lets the mapping be tested over real pipeline output.
 */
function findAnchorElementAtOffset(
	root: AnchorNode,
	offset: number,
	measure: MeasureAnchorBox,
): AnchorMatch | null {
	if (!Number.isFinite(offset)) return null;
	return descend(root, null, (_span, node) => boxDistance(measure(node), offset), false);
}

/**
 * Where to scroll so `line` sits `offset` pixels below the top of the viewport,
 * interpolating linearly across the resolved element for multi-line blocks.
 *
 * `elementTop` is `offsetTop`, matching what `getPreviewScrollAnchor` measures
 * on the way in. Both sides read the same property on the same element, so a
 * positioned ancestor above the scroll container shifts both by the same amount
 * and cancels out of the round trip.
 */
export function getAnchorScrollTop(
	elementTop: number,
	elementHeight: number,
	range: LineRange,
	line: number,
	offset: number = PREVIEW_ANCHOR_OFFSET,
): number {
	const totalLines = range.endLine - range.startLine;
	const ratio = totalLines > 0 ? Math.max(0, Math.min(1, (line - range.startLine) / totalLines)) : 0;

	return Math.max(0, elementTop + elementHeight * ratio - offset);
}

/**
 * The source line rendered at `offset` in the preview's scroll content —
 * fractional, interpolated across the block that owns the offset.
 *
 * This is the half of split-view scroll sync that a ratio cannot do. Forty
 * source lines of table render as a tall block and forty of prose as a short
 * one, so the share of the preview's scroll range a position occupies is not
 * the share of the document it corresponds to. Asking which block is on screen
 * and where inside it does not care.
 *
 * `null` only when the preview holds no annotated block at all.
 */
export function getSourceLineAtPreviewOffset(
	root: AnchorNode,
	offset: number,
	measure: MeasureAnchorBox,
): number | null {
	const match = findAnchorElementAtOffset(root, offset, measure);
	if (!match) return null;

	const box = measure(match.element);
	if (!Number.isFinite(box.top) || !Number.isFinite(box.height)) return null;

	const totalLines = match.endLine - match.startLine;
	if (totalLines <= 0 || box.height <= 0) return match.startLine;

	const ratio = Math.max(0, Math.min(1, (offset - box.top) / box.height));
	return match.startLine + totalLines * ratio;
}

/**
 * The inverse: where in the preview's scroll content `line` is rendered.
 * Interpolates through `getAnchorScrollTop` — the same interpolation the tab
 * restore uses — with no viewport offset applied, so the caller decides where
 * on screen to put it.
 *
 * `null` only when the preview holds no annotated block at all.
 */
export function getPreviewOffsetForSourceLine(
	root: AnchorNode,
	line: number,
	measure: MeasureAnchorBox,
): number | null {
	const match = findNearestAnchorElement(root, line);
	if (!match) return null;

	const box = measure(match.element);
	if (!Number.isFinite(box.top) || !Number.isFinite(box.height)) return null;

	return getAnchorScrollTop(box.top, box.height, match, line, 0);
}
