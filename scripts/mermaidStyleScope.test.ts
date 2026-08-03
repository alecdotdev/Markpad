import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/*
 * Mermaid emits a `<style>` block built partly from text the document
 * controls, and `sanitizeDiagramSvg` deliberately lets it through — the
 * document policy's `FORBID_TAGS: ['style']` would strip it and leave every
 * diagram an unstyled skeleton. That makes "can a document write CSS that
 * escapes its own diagram" a real question, and it was audited rather than
 * assumed: ~110 payloads across every entry point a document controls
 * (`classDef`, `style`, `linkStyle`, `themeVariables`, `fontFamily`,
 * `themeCSS` via `%%{init}%%` and via YAML front matter, at-rules, label HTML,
 * `securityLevel` self-override, textual `</style>` breakout), driven through
 * the real Mermaid 11.16.0 in headless Chrome, measuring `getComputedStyle`
 * and `elementFromPoint` on probes placed OUTSIDE the diagram.
 *
 * Result: no payload reached a selector matching an ancestor of the diagram's
 * `<svg>`, so `.titlebar{display:none}` and `body::after{background-image:…}`
 * are both unreachable. What holds it up is Mermaid-internal, in four
 * independent places — none of them `sanitizeDiagramSvg`, which was measured
 * to be a byte-for-byte pass-through for the style block in all 96 cases:
 *
 *   1. stylis' `addNamespace` middleware prefixes every emitted selector with
 *      `#<svg-id>`, and CSS has no ancestor combinator.
 *   2. `sanitizeCss`'s RUNNING brace-balance check (depth may never go
 *      negative) is what stops a payload closing the `#<svg-id>{ … }` wrapper
 *      early. Overall balance would not be enough.
 *   3. The `CSSStyleSheet.replaceSync()` round-trip re-serialises only rules
 *      the browser's own parser accepted, so raw text — `</style>`, unbalanced
 *      constructs — cannot survive into the block.
 *   4. `config.sanitize()` deletes any string option containing `<`, `>` or
 *      `url(data:`, and any key on the `secure` list (which includes
 *      `securityLevel`, so a document cannot lower it).
 *
 * `securityLevel` is NOT part of this. It governs HTML inside diagram labels;
 * it does not gate CSS generation.
 *
 * TWO THINGS THIS FILE PINS, because both are currently held by accident
 * rather than by design:
 *
 *   A. The `&` gap is real. stylis substitutes `&` with the namespace, and
 *      `addNamespace` then skips a selector that already starts with it, so
 *      `themeCSS: "& ~ *{display:none}"` emits `#<svg-id>~*{display:none}` —
 *      measured live to hide a `<span>` placed next to the `<svg>`. It reaches
 *      nothing in Markpad only because the `<svg>` is the sole child of its
 *      container everywhere it is mounted.
 *   B. A document can make its own `<svg>` `position:fixed` and cover the
 *      whole preview pane. It cannot cross into the title bar only because
 *      `.markdown-body` carries `transform: translate3d(0,0,0)` — added for
 *      scroll performance — which makes it the containing block for fixed
 *      descendants.
 *
 * These are source assertions: they cannot prove browser behaviour, only that
 * the two conditions the audit measured are still the ones in the tree. The
 * audit itself is the evidence; this file is the tripwire.
 */

const richContent = readFileSync('src/lib/utils/richContent.ts', 'utf8');
const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');

/** The block that builds and fills a `.mermaid-diagram` container. */
function diagramMountBlock(): string {
	const start = richContent.indexOf("container.className = 'mermaid-diagram'");
	assert.notEqual(start, -1, 'the diagram container is no longer built here');
	const end = richContent.indexOf('preEl.replaceWith(container)', start);
	assert.notEqual(end, -1, 'the diagram container is no longer mounted here');
	return richContent.slice(start, end);
}

test('the diagram container is filled by assignment, never appended to', () => {
	// Invariant A: an `<svg>` with no siblings. Every mount point must replace
	// the container's contents wholesale; an `appendChild` next to the svg is
	// what re-arms the `&` gap.
	const block = diagramMountBlock();
	assert.match(
		block,
		/container\.innerHTML = sanitizeDiagramSvg\(svg\);/,
		'the container must be filled by assignment, so the svg has no siblings',
	);
	assert.doesNotMatch(
		block,
		/container\.(appendChild|append|insertBefore|insertAdjacentHTML)\s*\(/,
		'nothing may be placed next to the svg: the mermaid <style> can select its siblings',
	);
	// `.code-block-shell` also uses appendChild, which is fine — that wrapper
	// holds no mermaid output. Scoping to the diagram block keeps this from
	// forbidding appendChild across the whole module.
});

test('the reason the mermaid style block is let through is still written down', () => {
	// The audit's value is that nobody has to redo it. If `sanitizeDiagramSvg`
	// ever grows a `FORBID_TAGS`, or the explanation is deleted, the next
	// reader is back to guessing.
	assert.match(richContent, /function sanitizeDiagramSvg/);
	assert.doesNotMatch(
		richContent.slice(richContent.indexOf('function sanitizeDiagramSvg'), richContent.indexOf('function sanitizeDiagramSvg') + 400),
		/FORBID_TAGS/,
		'the diagram policy must not adopt the document policy; it would strip every diagram bare',
	);
	assert.match(richContent, /& ~ \*/, 'the measured `&` gap must stay documented at the container');
});

test('the preview body still creates a containing block for fixed positioning', () => {
	// Invariant B. A document can set its own svg to `position: fixed`; this
	// transform is what keeps that inside the preview pane instead of over the
	// title bar. It is there for scroll performance, which means someone
	// optimising scrolling could remove it without knowing what else it holds.
	// It lives in the component's scoped style block, not styles.css.
	assert.match(
		viewer,
		/transform:\s*translate3d\(0,\s*0,\s*0\)/,
		'removing this transform lets a diagram position itself over the app chrome',
	);
});
