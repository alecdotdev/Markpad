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

// The app paints itself from CSS variables that are selected by an attribute on
// the root element: `:root[data-theme="dark"]`, `:root[data-theme="light"]` and
// — for an imported VS Code theme — `:root[data-theme="vscode"]`, whose rule is
// generated into a `<style>` tag and therefore travels with the copied
// stylesheet. Without the attribute on the exported document none of those
// selectors can ever match, so a file exported from a dark or an imported theme
// arrived looking like neither.
//
// `system` is the deliberate exception. It is not a colour, it is the
// instruction "use the colours of the machine I am reading this on", and the
// app implements it by removing the attribute and letting
// `@media (prefers-color-scheme: dark)` decide. An export carrying no attribute
// reproduces exactly that: the same document, the same cascade, resolved
// wherever it is opened. Freezing the exporter's momentary system colour
// instead would produce a file that disagrees with the author's own screen the
// next time their machine switches at sunset.
//
// The value is validated rather than trusted: it is interpolated into markup,
// and `data-theme` is a plain string that a future import path could take from
// a theme file. Anything unexpected degrades to the no-attribute (viewer's
// system) case rather than escaping the attribute's quotes.
const SAFE_EXPORT_THEME = /^[A-Za-z0-9_-]{1,32}$/;

export function exportThemeAttribute(theme: string | null | undefined): string {
	if (typeof theme !== 'string' || !SAFE_EXPORT_THEME.test(theme)) return '';
	return ` data-theme="${theme}"`;
}

export interface ExportDocumentInput {
	/** `document.documentElement.dataset.theme`, i.e. undefined for `system`. */
	theme: string | null | undefined;
	title: string;
	/** The app's own stylesheets, already serialised. */
	styles: string;
	/** The finished `.markdown-body` content. */
	articleHtml: string;
}

/**
 * Assembles the single file that leaves the app. Kept separate from
 * `exportAsHtml` (which owns the file dialog, the renderer round trip and the
 * image embedding) so the shape of the artefact can be asserted directly.
 */
export function buildExportDocument(input: ExportDocumentInput): string {
	return `<!DOCTYPE html>
<html lang="en"${exportThemeAttribute(input.theme)}>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtmlText(input.title || 'Export')}</title>
<style>
${input.styles}
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
/* Nothing in an exported file can open a fold: the policy above forbids
   script, and the app's toggles are not there to click. A section that ships
   collapsed therefore ships unreadable — its text is in the file, clipped to
   zero height at zero opacity, with nothing that could ever reveal it.
   Heading folds arrive open already (the render above is handed an empty fold
   state); a callout written as "> [!note]-" carries its collapsed state in the
   markup itself and has to be opened here. The print/PDF route takes the same
   position from the other side, in the @media print block of styles.css. */
.foldable-content-wrapper.is-collapsed {
	height: auto !important;
	opacity: 1 !important;
	overflow: visible !important;
}
.markdown-alert-content.is-collapsed {
	grid-template-rows: 1fr !important;
	opacity: 1 !important;
	overflow: visible !important;
}
.foldable-content-wrapper .content-inner,
.markdown-alert-content .content-inner {
	overflow: visible !important;
}
.header-fold-icon,
.callout-fold-icon {
	display: none !important;
}
</style>
</head>
<body>
<article class="markdown-body">
${input.articleHtml}
</article>
</body>
</html>`;
}

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
	// No collapsed headers, ever. An export is the act of handing the document
	// to someone who does not have the app, the fold state or a way to open one,
	// so every section ships expanded — a fold is a reading convenience of this
	// session, not part of the document. The print/PDF path is held to the same
	// rule from the other end (see the `@media print` block in styles.css, which
	// un-collapses folds instead of clipping them to zero height), so the two
	// export routes cannot disagree about what is in the file.
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

	const fullHtml = buildExportDocument({
		theme: document.documentElement.dataset.theme,
		title: ctx.tabTitle,
		styles,
		articleHtml: article.html,
	});

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
