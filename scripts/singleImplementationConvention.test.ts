import assert from 'node:assert/strict';
import test from 'node:test';

import { SANITIZER_FILES, filesMatching, readSourceFiles } from './sourceTree.js';

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
// A marker is only allowed to be something the compiler cannot see for itself:
// an exported symbol or type name, a magic string handed to another language or
// library (a Tauri command, a Monaco language id, a CSS custom property), or the
// literal shape of a defect that must never come back. A marker must never be a
// private identifier — a parameter name, a local variable, a helper that nothing
// outside its own file can reach. `every rule keeps at least one live
// implementation` below turns every marker into something a rename can break, so
// pinning a private name would promote it to a public contract and make ordinary
// local refactoring fail this suite for no behavioural reason.
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
		allowed: ['src/lib/utils/mermaidPrint.ts', 'src/lib/utils/richContent.ts'],
		requires: {
			pattern: /rememberDiagramSource/,
			message: 'a Mermaid render site must record the source via rememberDiagramSource',
		},
	},
	{
		name: 'Mermaid theme resolution has one implementation',
		why: 'resolveMermaidTheme in mermaidPrint.ts is shared by the on-screen render and the print restore so the two cannot drift; a second site deciding the theme is that drift.',
		// Pins the exported helper, not the `'dark' : 'neutral'` ternary inside it:
		// the ternary is one of many spellings of the same decision (an if/else or
		// double quotes slipped straight past), while what actually has to stay
		// single is the function both paths call. What the function *returns* for
		// each appearance setting is checked for real — by calling it — in
		// mermaidPrintTheme.test.ts.
		marker: /resolveMermaidTheme\s*\(/g,
		allowed: ['src/lib/MarkdownViewer.svelte', 'src/lib/utils/mermaidPrint.ts'],
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
		// Allowed nowhere. The entry that used to sit here covered
		// `replaceWithYoutubeEmbed` in MarkdownViewer.svelte, an uncalled
		// pre-fix leftover, and said to delete the two together — #388 deleted
		// the copy, so the entry goes with it and the rule now guards the
		// whole tree.
		allowed: [],
	},
	{
		name: 'DOMPurify is configured in one place',
		why: 'The sanitize contract lives in utils/sanitize.ts; an inline DOMPurify config elsewhere is a second, unreviewed sanitizer.',
		// Import sites, so an aliased `import purify from "dompurify"` cannot slip
		// past the `DOMPurify.sanitize(` call-site scan in previewSanitize.test.ts.
		// Both scans read the same allowlist so a new sanitizer is one decision.
		marker: /from\s+["']dompurify["']/g,
		allowed: SANITIZER_FILES,
	},
	{
		name: 'the raw render_markdown command has one set of call sites',
		why: 'Every preview render must go through renderMarkdownPreview, which strips YAML front matter before invoking the Rust renderer; a raw invoke elsewhere renders the front matter as body text. The command name is a string, so the compiler cannot see the call at all.',
		// The viewer half — that its one occurrence sits inside
		// renderMarkdownPreview rather than merely in the same file — is pinned by
		// renderPipelineConvention.test.ts.
		marker: /invoke\(\s*'render_markdown'/g,
		allowed: ['src/lib/MarkdownViewer.svelte', 'src/lib/utils/export.ts'],
	},
	{
		name: 'rich-content rendering has one implementation',
		why: 'utils/richContent.ts owns the render pipeline (highlight.js + KaTeX + Mermaid) for both the preview and the HTML export; a second renderRichContent is a fork that drifts from it — which is exactly how the export ended up shipping raw LaTeX and unhighlighted code.',
		// The viewer keeps a same-named wrapper that supplies the live element and
		// the copy-button behaviour, so the marker has to separate the two. It does
		// that on the exported options *type* — a real contract the export imports
		// — rather than on the parameter being spelled `options`, which is private
		// to the implementation and free to be renamed.
		marker: /function\s+renderRichContent\s*\([^)]*\bRenderRichContentOptions\b/g,
		allowed: ['src/lib/utils/richContent.ts'],
	},
	{
		name: 'editor language mapping has one implementation',
		why: 'A second extension-to-language table drifts from the one the editor actually uses, and the editor then opens a file under the wrong Monaco grammar.',
		// Pins the Monaco language id the table falls back to, not the private
		// `getLanguage` helper that happens to hold it today: 'plaintext' is a
		// magic string Monaco defines and TypeScript cannot check, and any second
		// extension table has to name it too.
		marker: /return '(?:plaintext)'/g,
		allowed: ['src/lib/MarkdownViewer.svelte'],
	},
	{
		name: 'highlight color palette has one definition',
		why: 'A second palette drifts from the one bound to the --highlight-color custom property, so find highlights and the settings preview disagree.',
		// Pins the custom property the palette feeds — the actual contract with
		// styles.css and FindBar.svelte, and a string no type system reads —
		// instead of the private `highlightColorMap` binding that produces it.
		marker: /--highlight-color:/g,
		allowed: ['src/lib/MarkdownViewer.svelte'],
	},
];

const SOURCES = readSourceFiles('src');

for (const rule of RULES) {
	test(`single implementation: ${rule.name}`, () => {
		const matched = filesMatching(SOURCES, rule.marker);

		const unexpected = matched.filter((path) => !rule.allowed.includes(path));
		assert.deepEqual(
			unexpected,
			[],
			`second implementation found — ${rule.why}\nReuse the existing one instead of copying it. If this really is a new legitimate site, add it to \`allowed\` with a reason.`,
		);

		if (rule.requires) {
			for (const path of matched) {
				const text = SOURCES.find((source) => source.path === path)!.text;
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
		assert.ok(
			filesMatching(SOURCES, rule.marker).length > 0,
			`rule "${rule.name}" matches nothing in src — update its marker or drop the rule`,
		);
	}
});
