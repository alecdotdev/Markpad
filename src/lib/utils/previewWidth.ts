export const MIN_PREVIEW_MAX_WIDTH = 640;
export const MAX_PREVIEW_MAX_WIDTH = 1600;
export const DEFAULT_PREVIEW_MAX_WIDTH = 880;

export function normalizePreviewMaxWidth(value: unknown): number {
	if (value === null || value === '') return DEFAULT_PREVIEW_MAX_WIDTH;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return DEFAULT_PREVIEW_MAX_WIDTH;
	return Math.min(MAX_PREVIEW_MAX_WIDTH, Math.max(MIN_PREVIEW_MAX_WIDTH, Math.round(parsed)));
}
