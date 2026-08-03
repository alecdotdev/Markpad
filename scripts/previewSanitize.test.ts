import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MARKDOWN_SANITIZE_CONFIG, ALLOWED_MARKDOWN_URI_REGEXP } from '../src/lib/utils/sanitize.js';
import { SANITIZER_FILES, callSiteOffsets, enclosingFunctionName, filesMatching, readSourceFiles } from './sourceTree.js';

// The preview is the path the `<style>` clause in the shared policy was written
// for, and it was the one path not using it. `tab.content` (the rendered,
// processed document) is injected into the *application's own* document by
// `{@html sanitizedHtml}`, so an author stylesheet is not scoped to the article.
// The viewer used to call DOMPurify itself with a hand-copied duplicate of the
// URI pattern and nothing else, and `<style>` is on DOMPurify's default
// allowlist with its CSS unfiltered.
//
// DOMPurify needs a real DOM, which the Node test runner does not have, so the
// behavioural half was measured against the pinned build (dompurify 3.4.12,
// `dist/purify.js`) in a real browser, with the payload below injected exactly
// the way `{@html}` injects it, into a document that also contained a
// `.titlebar` element:
//
//   config                                     output          .titlebar        body background-image
//   {ALLOWED_URI_REGEXP}        (before)        <style> kept    display: none    url("https://attacker.example/beacon")
//   MARKDOWN_SANITIZE_CONFIG    (after)         <style> gone    display: flex    none
//
// The beacon was not hypothetical: `performance.getEntriesByType('resource')`
// listed `https://attacker.example/beacon` after the injection. In the app both
// halves are permitted by the shipped CSP — `style-src 'self' 'unsafe-inline' …`
// and `img-src 'self' asset: https: …` (src-tauri/tauri.conf.json).
//
// What is checkable here is the wiring that decides which config the preview
// gets, and that is what these tests pin.
const POC_STYLE = '<style>.titlebar{display:none} body{background-image:url("https://attacker.example/beacon")}</style>';

const SOURCES = readSourceFiles('src');
const viewerSource = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const sanitizeSource = readFileSync('src/lib/utils/sanitize.ts', 'utf8');
const richContentSource = readFileSync('src/lib/utils/richContent.ts', 'utf8');

/**
 * The identifier the preview injects with `{@html}`, proved to be the shared
 * sanitizer's output.
 *
 * The chain is what matters — something is declared from
 * `sanitizeMarkdownHtml(...)` and *that* something is what reaches `{@html}` —
 * so this reads the name out of the source instead of pinning it. The previous
 * form spelled the whole declaration out (`let sanitizedHtml = $derived(...)`),
 * which made the private binding name, the `let`, and the `$derived` wrapper
 * into contract; renaming the variable or switching how it is computed would
 * have failed the suite while the security property held.
 */
function sanitizedSinkName(): string {
	const declaration = viewerSource.match(/(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\bsanitizeMarkdownHtml\(/);
	assert.ok(declaration, 'the preview must derive what it injects from sanitizeMarkdownHtml');
	return declaration![1];
}

test('the preview sanitizes through the shared policy, not a local config', () => {
	assert.match(
		viewerSource,
		/import\s*\{[^}]*\bsanitizeMarkdownHtml\b[^}]*\}\s*from\s*'[^']*\/sanitize\.js'/,
		'the viewer must import the shared sanitizer',
	);

	// The sink itself: every bare `{@html ident}` in the viewer injects the
	// sanitizer's output and nothing else. Stated over *all* of them rather than
	// over one known-good spelling, so adding a second injection point of the raw
	// document is a failure instead of an unnoticed addition.
	const injected = [...new Set([...viewerSource.matchAll(/\{@html\s+([A-Za-z_$][\w$]*)\s*\}/g)].map((m) => m[1]))];
	assert.deepEqual(injected, [sanitizedSinkName()], 'the preview sink must inject the shared sanitizer output');

	// The regression itself — a DOMPurify call with a config assembled at the
	// call site — is caught for the whole tree by the call-site allowlist below;
	// the viewer is not on it. What stays here is the other half of that
	// regression, which the allowlist cannot see: the viewer hand-copied the URI
	// pattern out of the shared policy.
	assert.doesNotMatch(
		viewerSource,
		/ALLOWED_URI_REGEXP/,
		'the viewer must not carry its own copy of the URI policy',
	);
});

test('the shared policy the preview now gets is the one that forbids author stylesheets', () => {
	// Read as one chain: the preview calls sanitizeMarkdownHtml (test above),
	// sanitizeMarkdownHtml passes MARKDOWN_SANITIZE_CONFIG, and that config
	// forbids the tag the payload needs.
	assert.match(sanitizeSource, /return DOMPurify\.sanitize\(html, MARKDOWN_SANITIZE_CONFIG\)/);
	assert.deepEqual(Object.keys(MARKDOWN_SANITIZE_CONFIG).sort(), ['ALLOWED_URI_REGEXP', 'FORBID_TAGS']);
	assert.deepEqual(MARKDOWN_SANITIZE_CONFIG.FORBID_TAGS, ['style']);
	assert.equal(MARKDOWN_SANITIZE_CONFIG.ALLOWED_URI_REGEXP, ALLOWED_MARKDOWN_URI_REGEXP);
	assert.match(POC_STYLE, /^<style>/);
});

// Every `DOMPurify.sanitize` in `src/` is a decision about what a piece of
// untrusted input is allowed to be, and the compiler cannot tell that a new one
// silently reintroduces a private policy — this file exists because that is
// precisely what happened. Pin the set of call sites: a document that reaches
// the DOM must go through `sanitizeMarkdownHtml`, and anything else has to
// justify itself.
//
// The allowlist itself (`sanitize.ts`, which owns the document policy, and
// `richContent.ts`, which sanitizes Mermaid's own SVG under a deliberately
// different config — it needs `foreignObject` and the inline `<style>` the
// document policy forbids, verified in a browser against the pinned DOMPurify)
// lives in scripts/sourceTree.ts, because singleImplementationConvention.test.ts
// pins the *import* sites against the same two files. It used to be written out
// in both places, so widening one and forgetting the other was a silent way to
// end up with one scan guarding a set the other had already given up on.
test('DOMPurify call sites in src are the allowlisted ones', () => {
	// A per-file occurrence count used to be asserted here as well. It is dropped
	// on purpose: what a reviewer has to approve is *which files* may configure a
	// sanitizer, and "richContent.ts calls it once, not twice" made every
	// refactor inside an already-approved file a test failure. A second config in
	// an allowlisted file is still visible — the two tests below pin what each of
	// the two configs must contain.
	assert.deepEqual(
		filesMatching(SOURCES, /DOMPurify\.sanitize\(/),
		SANITIZER_FILES,
		'unexpected DOMPurify.sanitize call site — rendered markdown goes through sanitizeMarkdownHtml',
	);
});

test('the diagram sanitizer stays separate from the document policy', () => {
	// Both halves of the split are asserted so a later "let us unify these"
	// change has to confront the reason: the diagram config must keep the tag
	// the document config forbids.
	assert.match(richContentSource, /ADD_TAGS: \['foreignObject'\]/);
	assert.ok(!MARKDOWN_SANITIZE_CONFIG.FORBID_TAGS.includes('foreignObject'));
	assert.ok(MARKDOWN_SANITIZE_CONFIG.FORBID_TAGS.includes('style'));
});

test('the two paths keep their opposite orders on purpose', () => {
	// The export sanitizes the renderer output and processes afterwards
	// (scripts/exportSanitize.test.ts pins that). The preview processes first
	// and sanitizes at the sink, so the string that reaches `{@html}` is exactly
	// the sanitizer's output — there is no parse/serialize round trip after the
	// filter has run. Pin the order so the difference cannot be "tidied up"
	// into a weaker one without reading why.
	//
	// The order is what is asserted, by naming the function each half runs in.
	// The previous form searched for the two statements verbatim — down to the
	// argument list `(html, filePath, collapsedHeaders)` and the trailing
	// semicolon — which pinned three private parameter names and a formatting
	// choice as the price of checking which call happens where.
	assert.deepEqual(
		callSiteOffsets(viewerSource, 'processMarkdownHtml').map((offset) => enclosingFunctionName(viewerSource, offset)),
		['renderMarkdownPreview'],
		'renderMarkdownPreview must be the one place that processes the renderer output',
	);
	assert.doesNotMatch(
		viewerSource,
		/processMarkdownHtml\(\s*sanitizeMarkdownHtml/,
		'the preview must not move the filter ahead of processing without revisiting the note above',
	);
	// The sink half — that what `{@html}` injects is the sanitizer's output — is
	// asserted over every injection point in the first test above.
});
