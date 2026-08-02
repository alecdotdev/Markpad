import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { MARKDOWN_SANITIZE_CONFIG, ALLOWED_MARKDOWN_URI_REGEXP } from '../src/lib/utils/sanitize.js';

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

const viewerSource = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const sanitizeSource = readFileSync('src/lib/utils/sanitize.ts', 'utf8');

test('the preview sanitizes through the shared policy, not a local config', () => {
	assert.match(
		viewerSource,
		/import \{ sanitizeMarkdownHtml \} from '\.\/utils\/sanitize\.js'/,
		'the viewer must import the shared sanitizer',
	);
	assert.match(
		viewerSource,
		/let sanitizedHtml = \$derived\(sanitizeMarkdownHtml\(htmlContent\)\)/,
		'the preview sink must run the shared sanitizer over tab.content',
	);

	// The regression itself: a DOMPurify call on the document HTML with a
	// config assembled at the call site. Whatever that config contains, it is
	// by construction not the shared one, and the `<style>` clause is exactly
	// the kind of rule that gets left out of a copy.
	assert.doesNotMatch(viewerSource, /DOMPurify\.sanitize\(\s*htmlContent/);
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
// justify itself here.
const SANITIZE_CALL_SITES: Record<string, number> = {
	// The shared policy itself.
	'src/lib/utils/sanitize.ts': 1,
	// Mermaid's own SVG output, not a user's markdown: it needs `foreignObject`
	// (which the document policy does not allow) and it depends on the inline
	// `<style>` the document policy forbids, so it is deliberately a different
	// configuration on a different input. Verified in a browser: the pinned
	// DOMPurify keeps mermaid's `<style>` under the diagram config and strips it
	// under MARKDOWN_SANITIZE_CONFIG, which would flatten every diagram.
	'src/lib/MarkdownViewer.svelte': 1,
	// Dead export kept in step with the viewer's copy of the same diagram
	// sanitizer; nothing imports it (see markdown.ts renderRichContent).
	'src/lib/utils/markdown.ts': 1,
};

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...walk(path));
		else if (/\.(ts|svelte|js)$/.test(name)) out.push(path);
	}
	return out;
}

test('DOMPurify call sites in src are the allowlisted ones', () => {
	const found: Record<string, number> = {};
	for (const path of walk('src')) {
		const count = readFileSync(path, 'utf8').split('DOMPurify.sanitize(').length - 1;
		if (count > 0) found[path.replace(/\\/g, '/')] = count;
	}
	assert.deepEqual(
		found,
		SANITIZE_CALL_SITES,
		'unexpected DOMPurify.sanitize call site — rendered markdown goes through sanitizeMarkdownHtml',
	);
});

test('the diagram sanitizer stays separate from the document policy', () => {
	// Both halves of the split are asserted so a later "let us unify these"
	// change has to confront the reason: the diagram config must keep the tag
	// the document config forbids.
	assert.match(viewerSource, /ADD_TAGS: \['foreignObject'\]/);
	assert.ok(!MARKDOWN_SANITIZE_CONFIG.FORBID_TAGS.includes('foreignObject'));
	assert.ok(MARKDOWN_SANITIZE_CONFIG.FORBID_TAGS.includes('style'));
});

test('the two paths keep their opposite orders on purpose', () => {
	// The export sanitizes the renderer output and processes afterwards
	// (scripts/exportSanitize.test.ts pins that). The preview processes first
	// and sanitizes at the sink, so the string that reaches `{@html}` is exactly
	// the sanitizer's output — there is no parse/serialize round trip after the
	// filter has run. Pin the shape so the difference cannot be "tidied up"
	// into a weaker one without reading why.
	const renderCall = viewerSource.indexOf('return processMarkdownHtml(html, filePath, collapsedHeaders);');
	const sinkCall = viewerSource.indexOf('let sanitizedHtml = $derived(sanitizeMarkdownHtml(htmlContent))');
	assert.ok(renderCall !== -1, 'renderMarkdownPreview must process the renderer output');
	assert.ok(sinkCall !== -1, 'the sink must sanitize');
	assert.doesNotMatch(
		viewerSource,
		/processMarkdownHtml\(\s*sanitizeMarkdownHtml/,
		'the preview must not move the filter ahead of processing without revisiting the note above',
	);
	assert.match(viewerSource, /\{@html sanitizedHtml\}/, 'the sink injects the sanitized string');
});
