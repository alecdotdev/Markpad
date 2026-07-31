export const MIN_PREVIEW_MAX_WIDTH = 640;
export const MAX_PREVIEW_MAX_WIDTH = 1600;
export const DEFAULT_PREVIEW_MAX_WIDTH = 880;

export function normalizePreviewMaxWidth(value: unknown): number {
	if (value === null || value === '') return DEFAULT_PREVIEW_MAX_WIDTH;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return DEFAULT_PREVIEW_MAX_WIDTH;
	return Math.min(MAX_PREVIEW_MAX_WIDTH, Math.max(MIN_PREVIEW_MAX_WIDTH, Math.round(parsed)));
}

export function getPreviewContentWidth(value: unknown, isFullWidth: boolean): number | null {
	return isFullWidth ? null : normalizePreviewMaxWidth(value);
}

export function adjustPreviewMaxWidth(value: unknown, delta: number): number {
	return normalizePreviewMaxWidth(normalizePreviewMaxWidth(value) + delta);
}

export function getStoredPreviewFullWidth(value: string | null, legacyValue: string | null): boolean {
	return (value ?? legacyValue) === 'true';
}
