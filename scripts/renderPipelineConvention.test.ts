import assert from 'node:assert/strict';
import test from 'node:test';

import { callSiteOffsets, enclosingFunctionName, readSource } from './sourceTree.js';

// Every preview render must go through renderMarkdownPreview, which strips
// YAML front matter before invoking the Rust renderer. Calling the raw
// `invoke('render_markdown')` command anywhere else silently bypasses that
// step — the compiler cannot catch it because the command name is a string.
//
// Which *files* may name the raw command is a single-implementation question and
// is pinned by the RULES table in singleImplementationConvention.test.ts. What is
// left here is the half that table cannot express: inside the viewer, the raw
// command must sit in renderMarkdownPreview and nowhere else.
//
// If you add a new render call site, use renderMarkdownPreview (or
// renderTabPreviewFromRaw for the full render-and-apply sequence) instead
// of widening the allowlist.

const VIEWER = 'src/lib/MarkdownViewer.svelte';
const WRAPPER = 'renderMarkdownPreview';

test('every raw render_markdown call in the viewer sits inside renderMarkdownPreview', () => {
	const viewer = readSource(VIEWER);
	const offsets = callSiteOffsets(viewer, 'invoke').filter((offset) =>
		/^invoke\(\s*'render_markdown'/.test(viewer.slice(offset)),
	);

	// Not "there is exactly one occurrence, and something matching the wrapper
	// name appears within 400 characters of it". That form passed as soon as a
	// single call was wrapped and stopped guarding the moment the function grew
	// past the window; this one names the enclosing function of *each* call, so a
	// second bypassing call site inside the same file is a failure rather than an
	// off-by-one in a character budget.
	assert.ok(offsets.length > 0, `${VIEWER} no longer invokes render_markdown — has the render path moved?`);
	assert.deepEqual(
		offsets.map((offset) => enclosingFunctionName(viewer, offset)),
		offsets.map(() => WRAPPER),
		`the raw render_markdown command must be invoked from ${WRAPPER}, which strips front matter first`,
	);
});
