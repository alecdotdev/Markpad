export type ExportedFileFormat = 'HTML' | 'PDF';
export type OpenExportedFileResult = 'opened' | 'declined' | 'failed';

export type OpenExportedFileLabels = {
	title?: string;
	message?: string;
};

export type OpenExportedFileDeps = {
	ask: (message: string, options?: { title: string; kind: 'info' }) => Promise<boolean>;
	openPath: (path: string) => Promise<void>;
	labels?: OpenExportedFileLabels;
	onError?: (error: unknown) => void;
};

export async function askToOpenExportedFile(
	path: string,
	format: ExportedFileFormat,
	deps: OpenExportedFileDeps,
): Promise<OpenExportedFileResult> {
	const targetPath = path.trim();
	if (!targetPath) return 'declined';

	const title = deps.labels?.title ?? 'Open exported file?';
	const message = deps.labels?.message ?? `Open exported ${format} file now?`;

	let shouldOpen = false;
	try {
		shouldOpen = await deps.ask(message, { title, kind: 'info' });
	} catch (error) {
		deps.onError?.(error);
		return 'failed';
	}

	if (!shouldOpen) return 'declined';

	try {
		await deps.openPath(targetPath);
		return 'opened';
	} catch (error) {
		deps.onError?.(error);
		return 'failed';
	}
}
