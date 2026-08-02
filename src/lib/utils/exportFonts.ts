/**
 * KaTeX web fonts for an exported HTML file.
 *
 * #382 decided not to inline any fonts into an export, and it was right at the
 * time: the export had no KaTeX output in it at all, so KaTeX's `@font-face`
 * rules travelled in the copied stylesheet as pure dead weight — rules whose
 * relative `url()`s 404 next to the exported file, and which the export CSP
 * (`font-src data:`) blocks anyway. Nothing referenced them, so nothing looked
 * wrong.
 *
 * Now that the export renders math, that reasoning inverts. Every `.katex`
 * subtree asks for `KaTeX_Main` first and falls back to
 * `Times New Roman, serif`, and KaTeX lays the formula out using *its own*
 * font metrics — glyph widths, the height of a fraction bar, where an accent
 * sits. Fall back and the layout stays but the glyphs no longer fit it, and
 * anything KaTeX draws from its dedicated fonts is simply not in Times:
 * stretchy delimiters (KaTeX_Size1–4), most AMS symbols, `\mathcal`,
 * `\mathfrak`, `\mathscr`. Those come out as tofu or as the wrong letter.
 *
 * So the fonts have to be embedded, and the only question is how many. All 20
 * faces are 296 KB raw / ~395 KB as base64 — paid by every export, including
 * the ones with no math. Instead this module works out which families the
 * rendered article actually references, embeds only those, and deletes the rest
 * of KaTeX's `@font-face` rules from the copied stylesheet. A document with no
 * math therefore gets *smaller* than before (the dead rules go too); a document
 * with ordinary algebra pays for KaTeX_Main and KaTeX_Math only.
 *
 * Granularity is the family, not the individual face. Picking the exact
 * weight/style would need the export to resolve the cascade (`\mathbf` sets
 * `font-weight` on top of a family, `<strong>` around math changes it again),
 * and getting that subtly wrong shows up as one italic variable silently
 * rendering in Times. "If a family is referenced at all, ship its faces" cannot
 * fail that way.
 */

/** `@font-face` families KaTeX declares; nothing else in the app ships fonts. */
const KATEX_FAMILY_PREFIX = 'KaTeX_';

function unquote(value: string): string {
	return value.trim().replace(/^["']|["']$/g, '');
}

/**
 * The class tokens of a selector, minus `katex` itself.
 *
 * Combinators are deliberately ignored: this is a "could this rule apply"
 * question, and over-including a family costs a few kilobytes while
 * under-including it costs a broken formula.
 */
function selectorClasses(selector: string): string[] {
	return [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)]
		.map((match) => match[1])
		.filter((name) => name !== 'katex');
}

export interface KatexFamilyRule {
	/** Class tokens that must all be present for the rule to apply. */
	classes: string[];
	families: string[];
}

/**
 * Every rule in the copied stylesheet that points some element at a KaTeX
 * family, read out of the stylesheet rather than hard-coded, so a KaTeX upgrade
 * that renames a class or adds a family is picked up without edits here.
 */
export function parseKatexFamilyRules(css: string): KatexFamilyRule[] {
	const rules: KatexFamilyRule[] = [];
	for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selector = match[1].trim();
		const body = match[2];
		if (!selector || selector.startsWith('@')) continue;
		const families = [...body.matchAll(/KaTeX_[A-Za-z0-9_]+/g)].map((m) => m[0]);
		if (families.length === 0) continue;
		for (const part of selector.split(',')) {
			if (!/\.katex\b/.test(part)) continue;
			rules.push({ classes: selectorClasses(part), families });
		}
	}
	return rules;
}

/** Every class token used anywhere under `root`, including `root` itself. */
export function collectClassNames(root: Element): Set<string> {
	const names = new Set<string>();
	// Walked rather than selected: `querySelectorAll('*')` is the one call that
	// would tie this to a full selector engine, and the walk is no slower.
	const visit = (element: Element) => {
		for (const name of (element.getAttribute('class') || '').split(/\s+/)) {
			if (name) names.add(name);
		}
		for (const child of Array.from(element.childNodes)) {
			if (child.nodeType === Node.ELEMENT_NODE) visit(child as Element);
		}
	};
	visit(root);
	return names;
}

/**
 * The KaTeX families the rendered article can actually ask for. Empty when the
 * document contains no math at all, which is the common case.
 */
export function collectUsedKatexFamilies(root: Element, css: string): Set<string> {
	const used = new Set<string>();
	const classNames = collectClassNames(root);
	if (!classNames.has('katex')) return used;

	for (const rule of parseKatexFamilyRules(css)) {
		if (!rule.classes.every((name) => classNames.has(name))) continue;
		for (const family of rule.families) used.add(family);
	}
	return used;
}

export interface KatexFontFace {
	family: string;
	/** The `url()` of the woff2 source, as written in the stylesheet. */
	woff2Url: string | null;
	/** Offsets of the whole `@font-face { … }` block in the stylesheet. */
	start: number;
	end: number;
}

/** Locates the `@font-face` blocks that belong to KaTeX. */
export function findKatexFontFaces(css: string): KatexFontFace[] {
	const faces: KatexFontFace[] = [];
	const pattern = /@font-face\s*\{/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(css))) {
		const bodyStart = match.index + match[0].length;
		const bodyEnd = css.indexOf('}', bodyStart);
		if (bodyEnd === -1) break;
		const body = css.slice(bodyStart, bodyEnd);
		const family = unquote(/font-family\s*:\s*([^;]+)/.exec(body)?.[1] ?? '');
		if (!family.startsWith(KATEX_FAMILY_PREFIX)) continue;

		let woff2Url: string | null = null;
		for (const url of body.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
			if (/\.woff2(\?|$)/i.test(url[2])) {
				woff2Url = url[2];
				break;
			}
		}
		faces.push({ family, woff2Url, start: match.index, end: bodyEnd + 1 });
	}
	return faces;
}

/**
 * Rewrites the copied stylesheet so that every KaTeX `@font-face` either
 * carries its font inline or is gone.
 *
 * A face whose bytes could not be read is deleted rather than left pointing at
 * a URL that does not exist next to the exported file: the rendering is
 * identical either way (the browser falls back), and a dead rule in a file that
 * is meant to be self-contained is just a lie about what it needs.
 */
export function inlineKatexFontFaces(
	css: string,
	usedFamilies: Set<string>,
	dataUrlByUrl: Map<string, string>,
): string {
	const faces = findKatexFontFaces(css);
	if (faces.length === 0) return css;

	let out = '';
	let cursor = 0;
	for (const face of faces) {
		out += css.slice(cursor, face.start);
		cursor = face.end;

		if (!usedFamilies.has(face.family)) continue;
		const dataUrl = face.woff2Url ? dataUrlByUrl.get(face.woff2Url) : undefined;
		if (!dataUrl) continue;

		const block = css.slice(face.start, face.end);
		out += block.replace(
			/src\s*:[^;}]*/,
			`src: url(${dataUrl}) format("woff2")`,
		);
	}
	out += css.slice(cursor);
	return out;
}

/**
 * Rewrites KaTeX's `@font-face` sources to absolute URLs while the stylesheet
 * they came from is still in hand.
 *
 * The build emits them relative to the stylesheet — `url(./KaTeX_Main-Regular.
 * <hash>.woff2)`, next to `_app/immutable/assets/…css` — and the stylesheet does
 * not sit next to the page. Resolving later, against `location.href`, silently
 * produces a URL that 404s and a formula that quietly falls back to a serif.
 * By the time the rules are one concatenated string the base is gone, so it has
 * to happen here.
 *
 * Only KaTeX's own faces are touched, and every one of those is either replaced
 * by a data URI or deleted before the file is written, so no internal app URL
 * can survive into the export.
 */
export function absolutizeKatexFontUrls(cssText: string, base: string | null): string {
	if (!/^@font-face/.test(cssText.trim()) || !cssText.includes(KATEX_FAMILY_PREFIX)) return cssText;
	return cssText.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, quote: string, url: string) => {
		try {
			return `url(${quote}${new URL(url, base || location.href).href}${quote})`;
		} catch {
			return whole;
		}
	});
}

/** The woff2 sources that have to be fetched for the families in use. */
export function katexFontUrlsToEmbed(css: string, usedFamilies: Set<string>): string[] {
	const urls = new Set<string>();
	for (const face of findKatexFontFaces(css)) {
		if (!usedFamilies.has(face.family) || !face.woff2Url) continue;
		urls.add(face.woff2Url);
	}
	return [...urls];
}

/** `btoa` in chunks: a 30 KB font blows the argument limit of `apply`. */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}

/**
 * Reads the app's own bundled font assets, by the absolute URLs
 * `absolutizeKatexFontUrls` produced. Same-origin, so it is allowed by the
 * app's `connect-src 'self'`; a failure is not fatal — the face is dropped and
 * that formula falls back to a serif.
 */
export async function fetchFontDataUrls(urls: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	await Promise.all(
		urls.map(async (url) => {
			try {
				const response = await fetch(url);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const bytes = new Uint8Array(await response.arrayBuffer());
				out.set(url, `data:font/woff2;base64,${bytesToBase64(bytes)}`);
			} catch (error) {
				console.warn('Failed to embed export font', url, error);
			}
		}),
	);
	return out;
}
