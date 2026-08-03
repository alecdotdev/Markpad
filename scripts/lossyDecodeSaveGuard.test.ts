import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { Tab } from '../src/lib/stores/tabs.svelte.js';
import { buildTransferredTab, snapshotTab, validateTransferPayload } from '../src/lib/utils/tabTransfer.js';

// Every read path decodes leniently (#371): a file in a legacy encoding
// (GBK, Big5, Shift-JIS, EUC-KR, CP1251 ...) opens as U+FFFD mojibake instead
// of failing. U+FFFD is not reversible — the original bytes are gone from the
// buffer. Writing that buffer back over the source file (auto-save does it
// 1.5s after the first keystroke) destroys the document permanently.
//
// The guard: Rust reports the fidelity of every decode, the tab carries it —
// through window restore and cross-window moves — and `documentSession`
// refuses to write such a buffer over the file it came from. That is the
// single choke point every writer shares, including MarkdownViewer's
// auto-save timer and the close dialogs. "Save As" to a *different* path
// stays open: the new file is genuinely UTF-8, so writing it is correct, and
// it is the user's only way out.

const session = readFileSync('src/lib/sessions/documentSession.svelte.ts', 'utf8');
const windowSession = readFileSync('src/lib/sessions/windowSession.svelte.ts', 'utf8');
const tabs = readFileSync('src/lib/stores/tabs.svelte.ts', 'utf8');
const rust = readFileSync('src-tauri/src/lib.rs', 'utf8');

function slice(source: string, start: string, end: string): string {
	const from = source.indexOf(start);
	assert.notEqual(from, -1, `expected to find ${start}`);
	const to = source.indexOf(end, from + start.length);
	assert.notEqual(to, -1, `expected to find ${end} after ${start}`);
	return source.slice(from, to);
}

const loadMarkdown = () => slice(session, 'async function loadMarkdown', 'async function saveContent');
const saveContent = () => slice(session, 'async function saveContent(', 'async function saveContentAs');
const saveContentAs = () => slice(session, 'async function saveContentAs', 'async function toggleTaskCheckbox');
const guard = () => slice(session, 'function refuseIfLossilyDecoded', 'function updateLoading');

test('one decoder, and it reports what it destroyed', () => {
	// The fact is known exactly once — when the bytes are decoded — and was
	// thrown away. `String::from_utf8` returning `Err` IS the fact, so the
	// shared decoder from #371 carries it instead of growing a second path.
	assert.match(rust, /struct DecodedText \{[^}]*\bcontent: String,[^}]*\blossy: bool/s);
	assert.match(rust, /fn decode_utf8_lossy\(bytes: Vec<u8>\) -> DecodedText/);
	assert.match(rust, /fn read_to_string_lossy\(path: &str\) -> std::io::Result<DecodedText>/);
	assert.equal(rust.match(/fn decode_utf8/g)?.length, 1, 'exactly one decoder');
});

test('both read commands can report fidelity', () => {
	assert.match(rust, /async fn open_markdown_preview\([^)]*\)\s*-> Result<\(String, String, bool, bool\), String>/s);
	assert.match(rust, /async fn read_file_content_checked\(path: String\) -> Result<\(String, bool\), String>/);
	assert.match(rust, /read_file_content_checked,/, 'the command must be registered');
});

test('a preview cut inside a multi-byte character is not called lossy', () => {
	// The preview stops at a fixed byte count, so a perfectly valid UTF-8 file
	// is routinely cut mid-character. Reporting that as lossy would lock every
	// large CJK/emoji document out of saving — a guard worse than the bug.
	const preview = slice(rust, 'fn build_markdown_preview', '#[tauri::command]');
	const trim = preview.indexOf('utf8_truncation_boundary');
	assert.notEqual(trim, -1, 'the split tail must be dropped before decoding');
	assert.ok(trim < preview.indexOf('decode_utf8_lossy'), 'trim first, then judge fidelity');
});

test('the tab carries the fidelity of its buffer', () => {
	// Required, not optional: a construction site that forgot it would default
	// to "safe to overwrite", and the failure mode is a destroyed document.
	assert.match(tabs, /hasReplacementChars: boolean;/);
	assert.doesNotMatch(tabs, /hasReplacementChars\?: boolean;/);
	assert.match(tabs, /setTabDecodedLossy\(id: string, lossy: boolean\)/);
	assert.equal(tabs.match(/hasReplacementChars: false/g)?.length, 4);
});

test('every load decides the flag instead of leaving it stale', () => {
	// A reload of a file the user has since converted to UTF-8 must clear it.
	const body = loadMarkdown();
	assert.match(body, /as \[string, string, boolean, boolean\]/);
	assert.match(body, /setTabDecodedLossy\(activeId, lossy\)/);
	// The full load REPLACES the preview's buffer, so it brings its own
	// verdict: a file can be valid UTF-8 for the first 50KB and not after.
	assert.match(body, /read_file_content_checked/);
	assert.match(body, /setTabDecodedLossy\(activeId, fullLossy\)/);
});

test('the editable-pane shortcut reports fidelity too', () => {
	// #374 added a second way into loadMarkdown: a pane that can WRITE skips
	// the preview and reads the whole file up front. That branch fills an
	// editable buffer, so it is exactly the kind of caller that must not use
	// the bare command — it would hand the editor unflagged mojibake.
	const body = loadMarkdown();
	assert.match(
		body,
		/if \(initialIsEditing \|\| initialIsSplit\) \{\s*\[content, lossy\] = \(await invoke\('read_file_content_checked'/,
	);
	// `ensureFullContent` was the one place the bare command survived, and only
	// because it re-read a file whose tab loadMarkdown had already flagged —
	// an invariant enforced by two call sites agreeing rather than by the code.
	// It now reads the fidelity itself, so no writable buffer in this file is
	// filled by a command that cannot report one.
	const bare = session.match(/invoke\('read_file_content'/g)?.length ?? 0;
	assert.equal(bare, 0, 'no writable buffer may be filled by the unchecked command');
	assert.match(
		slice(session, 'async function ensureFullContent', 'const lossySaveWarnedTabs'),
		/invoke\('read_file_content_checked'/,
	);
	assert.match(
		slice(session, 'async function ensureFullContent', 'const lossySaveWarnedTabs'),
		/setTabDecodedLossy\(tabId, lossy\)/,
	);
});

test('the flag is set before the buffer can reach a writer', () => {
	const body = loadMarkdown();
	const set = body.indexOf('setTabDecodedLossy(activeId, lossy)');
	const firstAwait = body.indexOf('options.renderMarkdown(content');
	assert.notEqual(set, -1, 'the preview branch must set the flag');
	assert.notEqual(firstAwait, -1);
	assert.ok(set < firstAwait, 'the flag must be set before the first await that follows the load');
});

test('window restore cannot launder the flag away', () => {
	// Restore reads each file back into an editable buffer. With the bare
	// command it produced mojibake that looked safe to save, so reopening the
	// app was a way around the guard.
	assert.match(windowSession, /read_file_content_checked/);
	assert.match(windowSession, /tabManager\.setTabDecodedLossy\(tab\.id, lossy\)/);
	assert.doesNotMatch(windowSession, /invoke\('read_file_content'/);
});

test('saveContent refuses to write a lossy buffer over its own file', () => {
	const body = saveContent();
	const refusal = body.indexOf('refuseIfLossilyDecoded');
	assert.notEqual(refusal, -1, 'saveContent must consult the guard');
	assert.match(body.slice(refusal, refusal + 120), /return false;/);
	assert.ok(
		refusal < body.indexOf("invoke('save_file_content'"),
		'the guard must run before save_file_content is invoked',
	);
});

test('the guard protects the source file only', () => {
	const body = guard();
	// An untitled buffer has no source file to destroy, and any other path is
	// a new UTF-8 file — neither is blocked.
	assert.match(body, /targetPath === ''/);
	assert.match(body, /targetPath !== tab\.path/);
	assert.match(body, /return true;/);
});

test('saveContent is the choke point auto-save and the close dialogs share', () => {
	// Auto-save lives in MarkdownViewer.svelte's debounce effect and the close
	// flow in canCloseTab; both call saveContent, so guarding it covers them
	// without touching either.
	assert.match(session, /const success = await saveContent\(tabId\);/);
	const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
	assert.match(viewer, /saveContent\(s\.id\)\.then\(/);
});

test('Save As to a new file stays open as the escape hatch', () => {
	const body = saveContentAs();
	assert.match(body, /invoke\('save_file_content', \{ path: selected, content: snapshot \}\)/);
	// Once written, the buffer matches a UTF-8 file of its own.
	assert.match(body, /setTabDecodedLossy\(tab\.id, false\)/);
});

test('Save As onto the same file is still a destructive overwrite', () => {
	const body = saveContentAs();
	// "The same file", not "the same string": the dialog can come back with
	// another spelling of the source file — a different case, or accents
	// composed differently — and on macOS and Windows that still lands on the
	// same bytes. The guard is therefore handed the target's resolved identity
	// as well as its path. See pathIdentityCaseFolding.test.ts, which drives
	// that refusal for real instead of reading for it.
	const refusal = body.indexOf('refuseIfLossilyDecoded(tab, selected');
	assert.notEqual(refusal, -1, 'picking the source file again must be refused');
	assert.ok(
		refusal < body.indexOf("invoke('save_file_content'"),
		'the guard must run before save_file_content is invoked',
	);
});

test('the refusal tells the user what to do and is not repeated per keystroke', () => {
	// Auto-save re-arms on every edit; an undeduplicated toast would fire
	// every 1.5s. The message names "Save As" because that is the only exit.
	const body = guard();
	assert.match(body, /toast\.lossySaveBlocked/);
	assert.match(body, /lossySaveWarnedTabs\.has\(tab\.id\)/);
	const i18n = readFileSync('src/lib/utils/i18n.ts', 'utf8');
	assert.match(i18n, /lossySaveBlocked: 'Not saved: this file is not UTF-8/);
	assert.match(i18n, /use "Save As" to write a copy/);
});

// --- Behavioural: the flag survives a cross-window move ------------------
// tabTransfer.ts is pure, so these run the real code instead of reading it.
// A moved tab carries its unsaved buffer; if the flag did not travel with it,
// the destination window would happily overwrite the source file.

function makeTab(overrides: Partial<Tab> = {}): Tab {
	return {
		id: 'source-id',
		path: '/notes/legacy.md',
		title: 'legacy.md',
		content: '<p>rendered</p>',
		rawContent: '# �� mojibake',
		originalContent: '# �� mojibake',
		scrollTop: 0,
		isDirty: false,
		isEditing: true,
		history: ['/notes/legacy.md'],
		historyIndex: 0,
		editorViewState: null,
		scrollPercentage: 0,
		anchorLine: 0,
		isSplit: false,
		splitRatio: 0.5,
		isScrollSynced: false,
		hasReplacementChars: true,
		...overrides,
	};
}

test('a moved tab arrives still refusing to overwrite its source', () => {
	const snap = snapshotTab(makeTab());
	assert.equal(snap.hasReplacementChars, true, 'the snapshot must carry it');

	const validated = validateTransferPayload(JSON.stringify(snap));
	assert.ok(validated, 'a snapshot of a real tab must validate');
	assert.equal(validated.hasReplacementChars, true);

	const arrived = buildTransferredTab(validated, [], 'Untitled');
	assert.equal(arrived.hasReplacementChars, true, 'the guard must survive the move');
});

test('a faithful buffer arrives savable', () => {
	const snap = snapshotTab(makeTab({ hasReplacementChars: false, rawContent: '# fine' }));
	const validated = validateTransferPayload(JSON.stringify(snap));
	assert.ok(validated);
	assert.equal(buildTransferredTab(validated, [], 'Untitled').hasReplacementChars, false);
});

test('a payload without the flag is rejected, not defaulted', () => {
	// The file's own doctrine: no coercion, no defaults. Defaulting a missing
	// flag to false would silently re-open the hole for any sender that
	// forgets it.
	const snap = snapshotTab(makeTab()) as Record<string, unknown>;
	delete snap.hasReplacementChars;
	assert.equal(validateTransferPayload(JSON.stringify(snap)), null);
});
