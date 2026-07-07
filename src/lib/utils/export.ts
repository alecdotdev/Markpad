import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getMarkdownBodyWithoutFrontMatter, parseFrontMatter } from './frontMatter.js';
import { processMarkdownHtml } from './markdown.js';
import {
	escapeHtmlText,
	renderStaticFrontMatterPanel,
	resolveExportImagePath,
	rewriteMarkdownHrefForExport,
} from './exportHtml.js';

interface ExportContext {
	rawContent: string;
	tabTitle: string;
	tabPath: string;
}

export type ExportHtmlResult = {
	path: string;
	embeddedImages: number;
	missingImages: number;
};

async function buildExportArticle(ctx: ExportContext): Promise<{ html: string; embeddedImages: number; missingImages: number }> {
	const body = getMarkdownBodyWithoutFrontMatter(ctx.rawContent);
	const rendered = (await invoke('render_markdown', { content: body })) as string;
	const processed = processMarkdownHtml(rendered, ctx.tabPath, new Set());
	const wrapper = document.createElement('div');
	wrapper.innerHTML = renderStaticFrontMatterPanel(parseFrontMatter(ctx.rawContent)) + processed;

	for (const link of Array.from(wrapper.querySelectorAll('a[href]'))) {
		const href = link.getAttribute('href');
		if (!href) continue;
		link.setAttribute('href', rewriteMarkdownHrefForExport(href));
	}

	let embeddedImages = 0;
	let missingImages = 0;
	for (const img of Array.from(wrapper.querySelectorAll('img[src]'))) {
		const src = img.getAttribute('src');
		if (!src) continue;

		const localPath = resolveExportImagePath(src, ctx.tabPath);
		if (!localPath) continue;

		try {
			const dataUrl = (await invoke('read_file_as_data_url', { path: localPath })) as string;
			img.setAttribute('src', dataUrl);
			embeddedImages += 1;
		} catch (e) {
			missingImages += 1;
			img.setAttribute('data-markpad-export-missing-src', src);
			console.warn('Failed to embed image for HTML export', localPath, e);
		}
	}

	return {
		html: wrapper.innerHTML,
		embeddedImages,
		missingImages,
	};
}

export async function exportAsHtml(ctx: ExportContext): Promise<ExportHtmlResult | null> {
	if (!ctx.rawContent) return null;

	const defaultName = ctx.tabPath ? ctx.tabPath.replace(/\.[^.]+$/, '.html') : 'export.html';

	const selected = await save({
		filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
		defaultPath: defaultName,
	});
	if (!selected) return null;

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

	const article = await buildExportArticle(ctx);

	const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtmlText(ctx.tabTitle || 'Export')}</title>
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
.export-frontmatter-panel {
	margin: 0 0 24px 0;
}
.export-frontmatter-panel .frontmatter-grid {
	display: grid;
	grid-template-columns: max-content minmax(0, 1fr);
	gap: 8px 16px;
	padding: 12px 0 0 0;
}
.export-frontmatter-panel .frontmatter-key {
	color: var(--color-fg-muted, #57606a);
	font-weight: 600;
}
.export-frontmatter-panel .frontmatter-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.export-frontmatter-panel .frontmatter-tag {
	border: 1px solid var(--color-border-default, #d0d7de);
	border-radius: 999px;
	padding: 2px 8px;
	background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
}
.markdown-body pre {
	white-space: pre-wrap !important;
	word-break: break-word !important;
}
</style>
</head>
<body>
<article class="markdown-body">
${article.html}
</article>
</body>
</html>`;

	try {
		await invoke('save_file_content', { path: selected, content: fullHtml });
		return {
			path: selected,
			embeddedImages: article.embeddedImages,
			missingImages: article.missingImages,
		};
	} catch (e) {
		console.error('Failed to export HTML', e);
		return null;
	}
}

export function exportAsPdf() {
	// The current PDF path delegates to the WebView/system print dialog. That
	// API does not expose the saved PDF path, so prompt+open belongs in a future
	// controlled PDF exporter that knows the target file.
	window.print();
}
