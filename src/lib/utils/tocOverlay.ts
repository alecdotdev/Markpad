export type TocSide = 'left' | 'right';

export interface TocPlacement {
	isEditing: boolean;
	isSplit: boolean;
	tocSide: TocSide;
}

export interface TocOverhangInput extends TocPlacement {
	isFullWidth: boolean;
	/** Client width of the VIEWER pane. Zero while that pane is collapsed. */
	viewerWidth: number;
	/** The preview's centred content width, or null when it fills the pane. */
	previewContentWidth: number | null;
	tocWidth: number;
}

/**
 * The narrowest gutter the outline may share with the text before it counts as
 * covering it. Below this the "gap" reads as a collision either way.
 */
const MIN_GUTTER = 50;

/**
 * Is the preview the thing underneath the outline?
 *
 * The outline is positioned against the LAYOUT container, not against the pane
 * it happens to land on. "Is there room beside the text?" is therefore only the
 * right question when the pane underneath is the preview: the preview centres
 * its content and leaves a gutter either side, while the editor fills its pane
 * edge to edge and has no gutter to lend.
 *
 * Which pane is underneath follows from which panes are rendered, because the
 * editor is always the first child and so takes the left edge whenever it is on
 * screen at all:
 *
 *   reading        viewer alone           → preview on both sides
 *   split          editor | viewer        → editor on the left, preview on the right
 *   editing only   viewer is `flex: 0`    → editor on both sides
 */
export function isTocOverPreview({ isEditing, isSplit, tocSide }: TocPlacement): boolean {
	const editorVisible = isSplit || isEditing;
	const viewerVisible = isSplit || !isEditing;
	return tocSide === 'right' ? viewerVisible : !editorVisible;
}

/**
 * Does the outline sit ON TOP of what the reader is reading?
 *
 * This drives the shadow and border that tell the reader the panel is floating
 * over their text rather than beside it, and it gates the auto-collapse: an
 * outline that is not covering anything has no reason to get out of the way.
 *
 * Measuring the viewer pane was only ever right in reading mode. In the other
 * two the outline covers the editor, and in editing-only mode `viewerWidth` is
 * 0, so the old test answered "no overlap" while the panel sat on the code.
 */
export function isTocOverhanging(input: TocOverhangInput): boolean {
	// Nothing under it centres its content, so there is no gutter to fall into.
	if (!isTocOverPreview(input)) return true;
	if (input.isFullWidth) return true;
	if (input.viewerWidth <= 0 || input.previewContentWidth === null) return false;
	const gutter = (input.viewerWidth - input.previewContentWidth) / 2;
	return input.tocWidth > Math.max(MIN_GUTTER, gutter);
}
