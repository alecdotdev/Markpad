import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// A fixed behavior must have exactly one implementation.
//
// The bug class this catches: a behavior gets fixed in file A while a stale
// pre-fix copy of the same logic survives in file B. Nothing type-checks the
// copy, nothing imports it, and it looks like a reusable shared helper — so the
// next person to "reuse" or "sync" it silently reverts a merged fix.
//
// The existing behavior tests cannot see this. youtubeExternalFallback.test.ts,
// taskToggleMemory.test.ts, mermaidPrintTheme.test.ts and previewScrollSync.ts
// each read one hard-coded file, so a second copy living anywhere else is
// invisible to them. Every rule below therefore scans the whole `src` tree and
// pins *which files* are allowed to contain the marker.
//
// To add a behavior: append a row. `allowed` is the complete set of src-relative
// paths permitted to match `marker`; anything else is a duplicate implementation.

type Rule = {
	name: string;
	// What breaks if a second copy of this appears.
	why: string;
	marker: RegExp;
	allowed: string[];
	// Optional: every allowed file that matches `marker` must also match this.
	requires?: { pattern: RegExp; message: string };
};

const RULES: Rule[] = [
	{
		name: 'mermaid rendering remembers the diagram source',
		why: 'PDF/HTML export re-renders Mermaid in the light theme from data-mermaid-source; a render path without rememberDiagramSource exports blank or dark-themed diagrams (#359).',
		marker: /mermaid\.render\(/g,
		allowed: ['src/lib/MarkdownViewer.svelte', 'src/lib/utils/mermaidPrint.ts'],
		requires: {
			pattern: /rememberDiagramSource/,
			message: 'a Mermaid render site must record the source via rememberDiagramSource',
		},
	},
	{
		name: 'Mermaid theme resolution has one implementation',
		why: 'resolveMermaidTheme in mermaidPrint.ts is shared by the on-screen render and the print restore so the two cannot drift; a hand-rolled dark/neutral ternary is that drift.',
		marker: /["']dark["']\s*:\s*["']neutral["']/g,
		allowed: ['src/lib/utils/mermaidPrint.ts'],
	},
	{
		name: 'editor scroll-sync max is measured from content height',
		why: 'Split-view scroll sync must not count the editor bottom padding; the pre-fix form subtracted the viewport height from getScrollHeight() (#316).',
		marker: /getScrollHeight\(\)\s*-\s*[^;\n)]*height/gi,
		allowed: [],
	},
	{
		name: 'YouTube links never become embedded frames',
		why: 'The app dropped frame-src from its CSP and renders YouTube as a thumbnail anchor that opens the browser; an iframe path is the pre-fix version and cannot load.',
		marker: /createElement\((['"])iframe\1\)/g,
		// KNOWN STALE COPY — replaceWithYoutubeEmbed in MarkdownViewer.svelte is
		// an uncalled pre-fix leftover. Delete it and this allowlist entry
		// together; the entry exists only so this rule can guard the rest of the
		// tree today.
		allowed: ['src/lib/MarkdownViewer.svelte'],
	},
	{
		name: 'DOMPurify is configured in one place',
		why: 'The sanitize contract lives in utils/sanitize.ts; an inline DOMPurify config elsewhere is a second, unreviewed sanitizer.',
		marker: /from\s+["']dompurify["']/g,
		allowed: ['src/lib/utils/sanitize.ts', 'src/lib/MarkdownViewer.svelte'],
	},
	{
		name: 'rich-content rendering has one implementation',
		why: 'The viewer owns the render pipeline (highlight.js + KaTeX + Mermaid); a second renderRichContent is a fork that drifts from it.',
		marker: /function\s+renderRichContent\s*\(/g,
		allowed: ['src/lib/MarkdownViewer.svelte'],
	},
	{
		name: 'editor language mapping has one implementation',
		why: 'A second extension-to-language table drifts from the one the editor actually uses.',
		marker: /function\s+getLanguage\s*\(/g,
		allowed: ['src/lib/MarkdownViewer.svelte'],
	},
	{
		name: 'highlight color palette has one definition',
		why: 'A second palette drifts from the one bound to the --highlight-color custom property.',
		marker: /(?:const|let)\s+highlightColorMap\b/g,
		allowed: ['src/lib/MarkdownViewer.svelte'],
	},
];

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...walk(path));
		else if (/\.(ts|svelte|js)$/.test(name)) out.push(path);
	}
	return out;
}

const SOURCES = walk('src').map((path) => ({
	path: path.replace(/\\/g, '/'),
	text: readFileSync(path, 'utf8'),
}));

for (const rule of RULES) {
	test(`single implementation: ${rule.name}`, () => {
		const matched = SOURCES.filter(({ text }) => new RegExp(rule.marker.source, rule.marker.flags).test(text));

		const unexpected = matched.map(({ path }) => path).filter((path) => !rule.allowed.includes(path));
		assert.deepEqual(
			unexpected,
			[],
			`second implementation found — ${rule.why}\nReuse the existing one instead of copying it. If this really is a new legitimate site, add it to \`allowed\` with a reason.`,
		);

		if (rule.requires) {
			for (const { path, text } of matched) {
				assert.match(text, rule.requires.pattern, `${path}: ${rule.requires.message}`);
			}
		}
	});
}

test('every rule keeps at least one live implementation', () => {
	// Guards the rules themselves: a marker that matches nothing has gone stale
	// (renamed symbol, deleted feature) and is silently no longer guarding.
	for (const rule of RULES) {
		if (rule.allowed.length === 0) continue;
		const matched = SOURCES.some(({ text }) => new RegExp(rule.marker.source, rule.marker.flags).test(text));
		assert.ok(matched, `rule "${rule.name}" matches nothing in src — update its marker or drop the rule`);
	}
});
