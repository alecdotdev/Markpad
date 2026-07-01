import { getFrontMatterListItems, type FrontMatterParseResult } from './frontMatter.js';
import { resolvePath } from './markdown.js';

const localMarkdownExtensionPattern = /\.(?:md|markdown|mdown|mkd|txt)$/i;
const windowsDrivePathPattern = /^[a-zA-Z]:[\\/]/;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function hasNonFileScheme(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !windowsDrivePathPattern.test(value);
}

function splitUrlSuffix(value: string): { base: string; suffix: string } {
	const queryIndex = value.indexOf('?');
	const hashIndex = value.indexOf('#');
	const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
	const splitIndex = indexes.length > 0 ? Math.min(...indexes) : -1;

	if (splitIndex === -1) return { base: value, suffix: '' };
	return {
		base: value.slice(0, splitIndex),
		suffix: value.slice(splitIndex),
	};
}

function decodePath(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function normalizeUrlPathname(pathname: string): string {
	let path = decodePath(pathname);

	if (/^\/[a-zA-Z]:\//.test(path)) {
		path = path.slice(1);
	} else if (path.startsWith('/\\\\')) {
		path = path.slice(1);
	} else if (path.startsWith('//')) {
		path = path.slice(1);
	}

	return path;
}

export function normalizeAssetPath(src: string): string | null {
	if (!src.startsWith('asset:')) return null;

	try {
		const url = new URL(src);
		return normalizeUrlPathname(url.pathname);
	} catch {
		const path = src.replace(/^asset:\/\/localhost\/?/i, '');
		return normalizeUrlPathname('/' + path);
	}
}

export function resolveExportImagePath(src: string, tabPath: string): string | null {
	const trimmed = src.trim();
	if (!trimmed) return null;
	if (/^(?:https?:|data:|blob:)/i.test(trimmed)) return null;

	const assetPath = normalizeAssetPath(trimmed);
	if (assetPath) return assetPath;

	if (/^file:/i.test(trimmed)) {
		try {
			return normalizeUrlPathname(new URL(trimmed).pathname);
		} catch {
			return null;
		}
	}

	if (hasNonFileScheme(trimmed)) return null;

	const { base } = splitUrlSuffix(trimmed);
	const decoded = decodePath(base);
	if (windowsDrivePathPattern.test(decoded) || decoded.startsWith('\\\\') || decoded.startsWith('/')) {
		return decoded.replace(/\\/g, '/');
	}

	return resolvePath(tabPath, decoded);
}

export function rewriteMarkdownHrefForExport(href: string): string {
	const trimmed = href.trim();
	if (!trimmed || hasNonFileScheme(trimmed)) return href;

	const { base, suffix } = splitUrlSuffix(trimmed);
	if (!localMarkdownExtensionPattern.test(base)) return href;

	return base.replace(localMarkdownExtensionPattern, '.html') + suffix;
}

export function renderStaticFrontMatterPanel(frontMatter: FrontMatterParseResult): string {
	if (!frontMatter.exists) return '';

	const count = frontMatter.valid ? frontMatter.fields.length : 0;
	const rows = frontMatter.valid
		? frontMatter.fields
			.map((field) => {
				const key = escapeHtml(field.key);
				const value = field.kind === 'list'
					? `<div class="frontmatter-tags">${getFrontMatterListItems(field)
						.map((item) => `<span class="frontmatter-tag">${escapeHtml(item)}</span>`)
						.join('')}</div>`
					: `<span class="frontmatter-static-value">${escapeHtml(field.displayValue)}</span>`;

				return `<div class="frontmatter-key">${key}</div><div class="frontmatter-value">${value}</div>`;
			})
			.join('')
		: `<div class="frontmatter-error">${escapeHtml(frontMatter.error || 'Invalid frontmatter')}</div>`;

	return `<details class="frontmatter-panel export-frontmatter-panel">
<summary class="frontmatter-summary">
<span class="frontmatter-chevron" aria-hidden="true">›</span>
<span class="frontmatter-title">Properties</span>
<span class="frontmatter-count">${count}</span>
</summary>
<div class="frontmatter-grid">${rows}</div>
</details>`;
}

export function escapeHtmlText(value: string): string {
	return escapeHtml(value);
}
