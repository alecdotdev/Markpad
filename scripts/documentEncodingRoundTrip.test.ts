import assert from 'node:assert/strict';
import test from 'node:test';

/*
 * #372: a document in a legacy encoding (GBK, Big5, Shift-JIS, CP-1252 …) is
 * detected and decoded on open, and a save writes it back as the SAME
 * encoding — the behaviour Notepad, VS Code and Typora all have, and the one
 * an app that calls itself "the Notepad equivalent for Markdown" is measured
 * against.
 *
 * The decoding and encoding themselves are Rust and are tested there
 * (`saving_an_unedited_legacy_document_reproduces_its_bytes_exactly` is the
 * one that matters). What has to hold on this side is the wiring, because it
 * is the wiring that decides which bytes reach the file:
 *
 *     read  →  tab.encoding  →  save
 *
 * A break anywhere in that chain does not fail loudly. It writes the user's
 * GBK document back as UTF-8, silently, on an auto-save 1.5s after the first
 * keystroke — no error, no toast, and every other tool that opens the file
 * afterwards sees mojibake. So the chain is driven here end to end rather
 * than read for.
 */

const g = globalThis as any;
const runeEffect = (fn: () => void) => {
	void fn;
};
runeEffect.root = (fn: () => unknown) => fn();
g.$state = (value: unknown) => value;
g.$state.raw = (value: unknown) => value;
g.$state.snapshot = (value: unknown) => value;
g.$derived = (value: unknown) => value;
g.$derived.by = (fn: () => unknown) => fn();
g.$effect = runeEffect;
g.window = g.window ?? {};
Object.defineProperty(g, 'navigator', { value: { language: 'en-US' }, configurable: true });
Object.defineProperty(g, 'localStorage', {
	value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
	configurable: true,
});

/** What the backend reports for the next read. Set per test. */
let fileEncoding = 'UTF-8';
let fileLossy = false;
const BODY = '# 中文标题';

/** Every `save_file_content` the session issued, in order. */
let writes: Array<{ path: string; content: string; encoding: string }> = [];

g.window.__TAURI_INTERNALS__ = {
	invoke: (command: string, args: Record<string, unknown>) => {
		const cmd = command.replace(/^plugin:[^|]*\|/, '');
		if (cmd === 'get_os_type') return Promise.resolve('macos');
		if (cmd === 'canonicalize_path') return Promise.resolve(args.path);
		if (cmd === 'open_markdown_preview') {
			return Promise.resolve(['', BODY, true, fileLossy, fileEncoding]);
		}
		if (cmd === 'read_file_content_checked') return Promise.resolve([BODY, fileLossy, fileEncoding]);
		if (cmd === 'save_file_content') {
			writes.push(args as unknown as { path: string; content: string; encoding: string });
			return Promise.resolve(null);
		}
		return Promise.resolve(null);
	},
};

const { tabManager } = await import('../src/lib/stores/tabs.svelte.js');
const { createDocumentSession } = await import('../src/lib/sessions/documentSession.svelte.js');
const { buildTransferredTab, snapshotTab, validateTransferPayload } = await import(
	'../src/lib/utils/tabTransfer.js'
);

function makeSession() {
	return createDocumentSession({
		setShowHome: () => {},
		currentFile: () => tabManager.activeTab?.path ?? '',
		resetScrollHistory: () => {},
		renderMarkdown: async () => '',
		afterLoad: async () => {},
		saveRecentFile: () => {},
		deleteRecentFile: () => {},
		setLoadingTabs: () => {},
		measureInitialViewport: () => {},
		isScrolling: () => false,
		renderRichContent: () => {},
		onError: () => {},
		selfWriteGraceMs: 400,
		cancelPendingAutoSave: () => {},
		askClose: async () => 'discard' as const,
		onCloseSaveNewerEdits: () => {},
		onCloseAutoSaveFailed: () => {},
	});
}

/** A tab opened from a file the backend reports as `encoding`. */
async function openedAs(encoding: string, lossy = false) {
	tabManager.closeAll();
	writes = [];
	fileEncoding = encoding;
	fileLossy = lossy;
	const session = makeSession();
	await session.loadMarkdown('/notes/legacy.md');
	return { session, tab: tabManager.activeTab! };
}

test('opening a legacy document records the encoding it was read in', async () => {
	const { tab } = await openedAs('GBK');
	assert.equal(tab.encoding, 'GBK');
	assert.equal(tab.hasReplacementChars, false, 'a detected encoding decodes; it does not substitute');
});

test('saving that document writes it back as itself, not as UTF-8', async () => {
	// The whole issue in one assertion. Under the old behaviour this write
	// carried the buffer and nothing else, so the file became UTF-8 — or,
	// before the buffer was decoded at all, U+FFFD.
	const { session, tab } = await openedAs('GBK');

	tabManager.updateTabRawContent(tab.id, `${BODY}\n\nedited`);
	assert.equal(await session.saveContent(tab.id), true);

	assert.deepEqual(writes.map((write) => write.encoding), ['GBK']);
	assert.equal(writes[0].path, '/notes/legacy.md');
});

test('a UTF-8 document is still written as UTF-8', async () => {
	// The fence. Everything above passes for a build that writes some
	// arbitrary encoding to every file it touches.
	const { session, tab } = await openedAs('UTF-8');

	tabManager.updateTabRawContent(tab.id, 'edited');
	assert.equal(await session.saveContent(tab.id), true);

	assert.deepEqual(writes.map((write) => write.encoding), ['UTF-8']);
});

test('a byte order mark is a property of the file, so it is carried too', async () => {
	// Windows-authored Markdown, and the case a plain "is it UTF-8?" test
	// misses: the text decodes perfectly, and dropping the BOM on save still
	// changes the file for every tool that reads it.
	const { session, tab } = await openedAs('UTF-8-BOM');
	assert.equal(tab.encoding, 'UTF-8-BOM');

	tabManager.updateTabRawContent(tab.id, 'edited');
	assert.equal(await session.saveContent(tab.id), true);
	assert.deepEqual(writes.map((write) => write.encoding), ['UTF-8-BOM']);
});

test('a re-read repoints the save at what the file is NOW', async () => {
	// The user converted the file to UTF-8 in another program. The tab must
	// stop writing GBK, and it learns that from the read rather than from
	// remembering how it was first opened.
	const { session, tab } = await openedAs('GBK');

	fileEncoding = 'UTF-8';
	await session.loadMarkdown('/notes/legacy.md');
	assert.equal(tabManager.activeTab!.encoding, 'UTF-8');

	tabManager.updateTabRawContent(tab.id, 'edited');
	assert.equal(await session.saveContent(tab.id), true);
	assert.deepEqual(writes.map((write) => write.encoding), ['UTF-8']);
});

test('an untitled buffer has an encoding before anything has been read', async () => {
	// Required, not optional, on the Tab — so a buffer that never came from a
	// file still answers, and answers the only thing it could be.
	tabManager.closeAll();
	tabManager.addNewTab();
	assert.equal(tabManager.activeTab!.encoding, 'UTF-8');
});

test('a moved tab keeps its encoding across the window boundary', async () => {
	// The buffer is a decode of a file in this encoding; the destination
	// window auto-saves it. A payload that dropped the field would rewrite the
	// user's GBK document as UTF-8 the moment it landed.
	const { tab } = await openedAs('Shift_JIS');

	const payload = JSON.stringify(snapshotTab(tab));
	const validated = validateTransferPayload(payload);
	assert.notEqual(validated, null, 'precondition: the payload validates');
	assert.equal(buildTransferredTab(validated!, [], 'Untitled').encoding, 'Shift_JIS');
});

test('a payload without an encoding is rejected rather than defaulted', async () => {
	// Same rule as `hasReplacementChars`: a missing field must not be read as
	// "UTF-8, go ahead", because that is a write to the user's file.
	const { tab } = await openedAs('Big5');
	const { encoding, ...withoutEncoding } = snapshotTab(tab);
	void encoding;

	assert.equal(validateTransferPayload(JSON.stringify(withoutEncoding)), null);
});
