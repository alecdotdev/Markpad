/**
 * Resolving a saved source line back to a rendered preview element.
 *
 * Scrolling the preview saves a source line (`tab.anchorLine`, produced by
 * `getPreviewScrollAnchor`) and re-activating the tab has to turn that line
 * back into a scroll offset. Both directions key off the `data-sourcepos`
 * attributes comrak writes onto the rendered blocks.
 *
 * The one thing that makes this non-trivial: `processMarkdownHtml` re-parents
 * everything that follows a heading into a `.foldable-content-wrapper` it
 * creates itself, and that wrapper has no `data-sourcepos` of its own. After
 * that pass the only top-level elements still carrying a source range are the
 * shallowest headings in the document, so a scan of `body.children` can only
 * ever match an anchor that landed exactly on one of those heading lines.
 *
 * `findAnchorElement` therefore descends. It treats an element without a source
 * range as a transparent container whose span is derived from its first and
 * last annotated descendants, which lets it skip a whole section in one
 * comparison instead of visiting every annotated element in the document. The
 * work is proportional to the number of siblings along the path to the match
 * (plus the fold depth), not to the document size — the restore runs once per
 * tab activation, but this keeps it off the same O(all elements) footing as the
 * per-scroll-event capture path.
 */

/** Inclusive source line range, as written in `data-sourcepos`. */
export type LineRange = {
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
	readonly childNodes: Iterable<AnchorNode>;
	getAttribute?(name: string): string | null;
	readonly classList?: { contains(token: string): boolean };
};

export type AnchorMatch = LineRange & {
	element: AnchorNode;
};

const ELEMENT_NODE = 1;

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
		if (child.nodeType === ELEMENT_NODE) out.push(child);
	}
	return out;
}

function ownRange(node: AnchorNode): LineRange | null {
	return parseSourceposLineRange(node.getAttribute?.('data-sourcepos'));
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

function contains(range: LineRange, line: number): boolean {
	return line >= range.startLine && line <= range.endLine;
}

function search(node: AnchorNode, line: number, inherited: AnchorMatch | null): AnchorMatch | null {
	for (const child of elementChildren(node)) {
		const own = ownRange(child);
		const span = own ?? resolveSpan(child);
		if (!span || !contains(span, line)) continue;

		const carried: AnchorMatch | null = own ? { element: child, ...own } : inherited;
		const fallback: AnchorMatch = carried ?? { element: child, ...span };

		if (!own && isCollapsedContainer(child)) return { element: child, ...span };

		return search(child, line, carried) ?? fallback;
	}

	return null;
}

/**
 * The narrowest visible element whose source range contains `line`, or `null`
 * when the line falls outside every rendered block (a stale anchor, or a blank
 * line between blocks) and the caller should fall back to a proportional
 * restore.
 */
export function findAnchorElement(root: AnchorNode, line: number): AnchorMatch | null {
	if (!Number.isFinite(line) || line <= 0) return null;
	return search(root, line, null);
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
