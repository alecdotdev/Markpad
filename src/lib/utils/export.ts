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
import { sanitizeMarkdownHtml } from './sanitize.js';

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

export interface PdfExportContext {
	tabPath: string;
	osType: 'macos' | 'windows' | 'linux' | 'unknown';
}

// An exported file leaves the app: it is opened in the user's default browser
// straight from the export prompt, mailed on, dropped in a shared folder. None
// of the app's own protections travel with it, so it carries its own policy as
// a second, independent line of defence behind the sanitizer — a bug in the
// filter should not be enough to get script into someone else's browser.
//
// Everything an export needs is inline or embedded, so the document needs no
// network privileges beyond images and media. Verified against a real export
// shape in Chrome (both over http: and as a `file://` document, where the meta
// tag is enforced the same way):
//   - `style-src 'unsafe-inline'` keeps the copied stylesheet and the inline
//     `style` attributes (`max-width:100%` on media) working; without it the
//     page loses all layout.
//   - `img-src`/`media-src data:` keeps embedded images and the `mask-image`
//     data URIs in the copied CSS working; `https:`/`http:` keeps images the
//     export deliberately leaves remote working.
//   - the only things the policy blocks are things that were already dead in an
//     exported file: `asset:` URLs left behind by an image that failed to embed,
//     and KaTeX's relative `@font-face` URLs, which 404 without the policy too.
//   - link navigation, `<details>` toggling and text selection are unaffected.
const EXPORT_CSP = [
	"default-src 'none'",
	'img-src data: https: http:',
	'media-src data: https: http:',
	"style-src 'unsafe-inline'",
	'font-src data:',
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

async function buildExportArticle(ctx: ExportContext): Promise<{ html: string; embeddedImages: number; missingImages: number }> {
	const body = getMarkdownBodyWithoutFrontMatter(ctx.rawContent);
	const rendered = (await invoke('render_markdown', { content: body })) as string;
	// The export used to write `rendered` to disk untouched. comrak runs with
	// `unsafe_ = true`, so a script the preview had filtered out was still live
	// in the exported file — and the exported file has no CSP of the app's, gets
	// opened in the user's default browser straight from the export prompt, and
	// gets forwarded to other people. Sanitize here, at the seam where the
	// untrusted document enters the pipeline, rather than after
	// `processMarkdownHtml`: everything that function emits (fold wrappers,
	// chevron SVGs, callout containers, `<video>`/`<audio>` replacements) plus
	// the front-matter panel below is markup Markpad builds itself, and running
	// the filter over our own output only creates a way for a future tightening
	// of the policy to silently delete parts of the export. Nothing downstream
	// can reintroduce untrusted markup: `processMarkdownHtml` parses with
	// DOMParser (inert — no script execution, no resource loads) and only ever
	// assigns `innerHTML` from its own constant SVG strings.
	const safeHtml = sanitizeMarkdownHtml(rendered);
	const processed = processMarkdownHtml(safeHtml, ctx.tabPath, new Set());
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
<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
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

export async function exportAsPdf(ctx: PdfExportContext) {
	if (ctx.osType !== 'windows') {
		await invoke('print_pdf');
		return;
	}

	const defaultName = ctx.tabPath ? ctx.tabPath.replace(/\.[^.]+$/, '.pdf') : 'export.pdf';
	const selected = await save({
		filters: [{ name: 'PDF', extensions: ['pdf'] }],
		defaultPath: defaultName,
	});
	if (!selected) return;

	await invoke('export_pdf_windows', { path: selected });
}
