import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

interface ExportContext {
	htmlContent: string;
	markdownBody: HTMLElement | null;
	tabTitle: string;
	tabPath: string;
}

export async function exportAsHtml(ctx: ExportContext) {
	if (!ctx.htmlContent) return;

	const defaultName = ctx.tabPath ? ctx.tabPath.replace(/\.[^.]+$/, '.html') : 'export.html';

	const selected = await save({
		filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
		defaultPath: defaultName,
	});
	if (!selected) return;

	let styles = '';
	for (const sheet of document.styleSheets) {
		try {
			for (const rule of sheet.cssRules) {
				styles += rule.cssText + '\n';
			}
		} catch {
			// cross-origin sheets
		}
	}

	const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ctx.tabTitle || 'Export'}</title>
<style>
${styles}
html, body {
	overflow: auto !important;
	height: auto !important;
	min-height: 100vh;
	background-color: var(--color-canvas-default, #ffffff);
	margin: 0;
	padding: 0;
}
.markdown-body {
	padding: 40px !important;
	max-width: 900px;
	margin: 0 auto;
	height: auto !important;
	overflow: visible !important;
	min-height: 100%;
}
.lang-label {
	display: none !important;
}
.markdown-body pre {
	white-space: pre-wrap !important;
	word-break: break-word !important;
}
</style>
</head>
<body>
<article class="markdown-body">
${ctx.markdownBody?.innerHTML || ctx.htmlContent}
</article>
</body>
</html>`;

	try {
		await invoke('save_file_content', { path: selected, content: fullHtml });
	} catch (e) {
		console.error('Failed to export HTML', e);
	}
}

export function exportAsPdf() {
	window.print();
}
