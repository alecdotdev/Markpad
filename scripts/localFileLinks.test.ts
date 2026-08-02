import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveLocalFileLinkPath } from '../src/lib/utils/localFileLinks.js';

/*
 * `[data](./data.csv)` did nothing on macOS and Linux, and opened a dead page
 * in the browser on Windows.
 *
 * The link is a path, but the click handler passed `anchor.href` — which the
 * DOM had already resolved against the webview's own origin. That origin is
 * `tauri://localhost` on macOS and Linux and `http://tauri.localhost` on
 * Windows, and the opener plugin's scope allows `mailto:`, `tel:`, `http://*`
 * and `https://*` (tauri-plugin-opener `allow-default-urls`). So the first
 * form was rejected as ForbiddenUrl — and, because the call was not awaited
 * inside a try/catch, the rejection went unhandled and the click was silent —
 * while the second matched `http://*` and was genuinely handed to the browser.
 *
 * The resolver below is pure, so these run the real code. The wiring in the
 * component is asserted against its source; those tests establish the order of
 * the branches and that both OS calls are guarded, not what the OS then does.
 */

const CURRENT = '/notes/doc.md';

test('a relative link resolves against the open file', () => {
	assert.equal(resolveLocalFileLinkPath('./data.csv', CURRENT), '/notes/data.csv');
	assert.equal(resolveLocalFileLinkPath('data.csv', CURRENT), '/notes/data.csv');
	assert.equal(resolveLocalFileLinkPath('../assets/report.pdf', CURRENT), '/assets/report.pdf');
	assert.equal(resolveLocalFileLinkPath('sub/dir/data.csv', CURRENT), '/notes/sub/dir/data.csv');
});

test('the path is decoded and stripped of URL decoration', () => {
	// The href in the document is percent-encoded markdown, not a filename.
	assert.equal(resolveLocalFileLinkPath('./my%20file.csv', CURRENT), '/notes/my file.csv');
	// A query string or fragment belongs to URLs; on disk they are part of no
	// filename, and leaving them on would look up a file that does not exist.
	assert.equal(resolveLocalFileLinkPath('./data.csv?v=2', CURRENT), '/notes/data.csv');
	assert.equal(resolveLocalFileLinkPath('./data.csv#row3', CURRENT), '/notes/data.csv');
});

test('absolute and Windows paths are taken as written', () => {
	assert.equal(resolveLocalFileLinkPath('/srv/shared/data.csv', CURRENT), '/srv/shared/data.csv');
	// A drive letter looks like a scheme and must not be treated as one.
	assert.equal(resolveLocalFileLinkPath('C:\\docs\\data.csv', CURRENT), 'C:/docs/data.csv');
	assert.equal(resolveLocalFileLinkPath('file:///tmp/data.csv', CURRENT), '/tmp/data.csv');
});

test('web addresses are left to the browser', () => {
	for (const href of [
		'https://example.com/data.csv',
		'http://example.com/data.csv',
		'mailto:someone@example.com',
		'tel:+15551234',
		'obsidian://open?vault=x',
		'data:text/csv;base64,YQ==',
		// Protocol-relative. The app already reads this as a web address for
		// markdown links, and reading it as a UNC path here would disagree.
		'//example.com/data.csv',
	]) {
		assert.equal(resolveLocalFileLinkPath(href, CURRENT), null, href);
	}
});

test('an in-page anchor is not a file', () => {
	assert.equal(resolveLocalFileLinkPath('#section', CURRENT), null);
	assert.equal(resolveLocalFileLinkPath('', CURRENT), null);
	assert.equal(resolveLocalFileLinkPath('   ', CURRENT), null);
});

test('an unsaved buffer has nothing to resolve a relative link against', () => {
	// `resolvePath('', './data.csv')` yields `data.csv`, which the OS would
	// open relative to the process's working directory — some arbitrary file,
	// or none. Refusing is the only honest answer.
	assert.equal(resolveLocalFileLinkPath('./data.csv', ''), null);
	assert.equal(resolveLocalFileLinkPath('data.csv', ''), null);
	// An absolute link still names exactly one file.
	assert.equal(resolveLocalFileLinkPath('/srv/data.csv', ''), '/srv/data.csv');
	assert.equal(resolveLocalFileLinkPath('C:\\data.csv', ''), 'C:/data.csv');
});

test('a markdown link still resolves to a path, so branch order is what keeps it in-app', () => {
	// Opening `./other.md` in a tab is a different, older feature. This
	// resolver cannot tell the two apart and must not try to; the click handler
	// asks about markdown targets first. The next test pins that order.
	assert.equal(resolveLocalFileLinkPath('./other.md', CURRENT), '/notes/other.md');
});

// --- wiring ------------------------------------------------------------------

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const handler = (() => {
	const from = viewer.indexOf('async function handleDocumentClick');
	assert.notEqual(from, -1);
	const to = viewer.indexOf('let zoomLevel', from);
	assert.notEqual(to, -1);
	return viewer.slice(from, to);
})();

test('markdown targets are still claimed before the local-file branch', () => {
	const markdown = handler.indexOf('getRelativeMarkdownTarget(rawHref)');
	const local = handler.indexOf('resolveLocalFileLinkPath(rawHref, currentFile)');
	assert.notEqual(markdown, -1);
	assert.notEqual(local, -1);
	assert.ok(markdown < local, '`./other.md` must open in a tab, not in an external editor');
});

test('a local file is handed to the OS as a path, not as a URL', () => {
	assert.match(handler, /await openPath\(localFilePath\)/);
	// The raw attribute, not `anchor.href`: the latter is the origin-resolved
	// URL that caused the bug.
	assert.match(handler, /resolveLocalFileLinkPath\(rawHref, currentFile\)/);
	const local = handler.indexOf('resolveLocalFileLinkPath');
	const url = handler.indexOf('await openUrl(anchor.href)');
	assert.notEqual(url, -1, 'genuine web links must still go to the browser');
	assert.ok(local < url, 'a local file must be caught before the URL fallback');
});

test('the capability still grants the command this depends on', () => {
	// `open_path` needs both the command grant and a path scope. Granting the
	// command alone leaves the plugin resolving
	// `fs_scope.is_allowed(path) && allowed.any(matches_path_program)` against
	// URL-only scope entries, which answer false to the second — that is how
	// `openPath` came to be refused with ForbiddenPath everywhere, including in
	// `askToOpenExportedFile` (#399, fixed in #403). Asserted here so the grant
	// cannot quietly disappear; the scope's shape is deliberately not asserted,
	// so narrowing it later is not a test failure.
	const capability = readFileSync('src-tauri/capabilities/default.json', 'utf8');
	assert.match(capability, /opener:allow-open-path/);
});

test('neither OS call can leave an unhandled rejection behind', () => {
	// `openUrl` rejects for anything outside the opener scope. Unawaited-in-
	// try/catch, that rejection was the whole visible symptom on macOS: nothing
	// happened, and nothing said why.
	for (const call of ['await openPath(localFilePath)', 'await openUrl(anchor.href)']) {
		const at = handler.indexOf(call);
		assert.notEqual(at, -1, call);
		const before = handler.slice(0, at);
		const tryAt = before.lastIndexOf('try {');
		const catchAfter = handler.indexOf('} catch (error) {', at);
		assert.notEqual(tryAt, -1, `${call} must be inside a try block`);
		assert.notEqual(catchAfter, -1, `${call} must have a catch`);
		assert.ok(before.slice(tryAt).split('} catch').length === 1, `${call} must be inside the nearest try`);
	}
	assert.equal(handler.match(/addToast\(`Failed to open/g)?.length, 2, 'both failures are reported');
});
