import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sliceBetween, sliceFrom } from './sourceTree.js';

// A markdown file larger than 50KB is opened twice: `open_markdown_preview`
// returns the first 50KB so something renders immediately, and a background
// `read_file_content` fills in the rest. Between the two, the tab's ONLY
// buffer is a partial copy of the document. Anything that writes that buffer
// back — auto-save, Cmd+S, a task checkbox, a tab moved to another window —
// permanently truncates the user's file.
//
// These tests drive the real TabManager and the real document session with a
// stubbed Tauri bridge, so they lock the behaviour, not the wording.

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

const PREVIEW_BYTES = 50000;
const FULL = `# big\n\n${'x'.repeat(PREVIEW_BYTES)}\n\ntail that must never be lost\n`;
const PARTIAL = FULL.slice(0, PREVIEW_BYTES);

let invokeCalls: Array<{ cmd: string; args: any }> = [];
/** Set per test. Return a never-settling promise to freeze the partial state. */
let handleInvoke: (cmd: string, args: any) => unknown = () => {
	throw new Error('unexpected invoke');
};

g.window.__TAURI_INTERNALS__ = {
	invoke: (cmd: string, args: any) => {
		invokeCalls.push({ cmd, args });
		return Promise.resolve(handleInvoke(cmd, args)).then((value) => value);
	},
};

const { tabManager } = await import('../src/lib/stores/tabs.svelte.js');
const { createDocumentSession } = await import('../src/lib/sessions/documentSession.svelte.js');

const viewer = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');

const errors: string[] = [];

function makeSession() {
	return createDocumentSession({
		setShowHome: () => {},
		currentFile: () => tabManager.activeTab?.path ?? '',
		resetScrollHistory: () => {},
		renderMarkdown: async (raw: string) => `<p>${raw.length}</p>`,
		afterLoad: async () => {},
		saveRecentFile: () => {},
		deleteRecentFile: () => {},
		setLoadingTabs: () => {},
		measureInitialViewport: () => {},
		isScrolling: () => false,
		renderRichContent: () => {},
		onError: (message) => errors.push(message),
		selfWriteGraceMs: 400,
		cancelPendingAutoSave: () => {},
		askClose: async () => 'discard' as const,
		onCloseSaveNewerEdits: () => {},
		onCloseAutoSaveFailed: () => {},
	});
}

function reset() {
	tabManager.closeAll();
	invokeCalls = [];
	errors.length = 0;
}

/** Open a >50KB file and leave the background full read pending forever. */
async function openPartial(path = '/docs/big.md') {
	handleInvoke = (cmd) => {
		if (cmd === 'open_markdown_preview') return ['<p>preview</p>', PARTIAL, false, false];
		if (cmd === 'read_file_content_checked') return new Promise(() => {});
		throw new Error(`unexpected invoke: ${cmd}`);
	};
	const session = makeSession();
	await session.loadMarkdown(path);
	const tab = tabManager.activeTab!;
	assert.equal(tab.rawContent, PARTIAL, 'precondition: the buffer is the partial read');
	return { session, tab };
}

test('a partially loaded buffer is marked as incomplete', async () => {
	reset();
	const { tab } = await openPartial();

	// Without this flag nothing downstream can tell a 50KB document from the
	// first 50KB of a 5MB one — the buffer looks authoritative and clean.
	assert.equal(tab.isTruncated, true);
	assert.equal(tab.isDirty, false);
});

test('a fully loaded buffer is not marked as incomplete', async () => {
	reset();
	handleInvoke = (cmd) => {
		if (cmd === 'open_markdown_preview') return ['<p>full</p>', FULL, true, false];
		throw new Error(`unexpected invoke: ${cmd}`);
	};
	const session = makeSession();
	await session.loadMarkdown('/docs/small.md');

	assert.notEqual(tabManager.activeTab!.isTruncated, true);
	assert.equal(tabManager.activeTab!.rawContent, FULL);
});

test('saving refuses to write a partial buffer over the file', async () => {
	reset();
	const { session, tab } = await openPartial();

	const saved = await session.saveContent(tab.id);

	assert.equal(saved, false);
	assert.equal(
		invokeCalls.some((call) => call.cmd === 'save_file_content'),
		false,
		'the partial buffer must never reach save_file_content',
	);
	assert.ok(errors.length > 0, 'the refusal is reported, not silent');
});

test('completing a partial buffer replaces it with the whole file and unblocks saving', async () => {
	reset();
	const { session, tab } = await openPartial();

	handleInvoke = (cmd) => {
		if (cmd === 'read_file_content_checked') return [FULL, false];
		if (cmd === 'save_file_content') return null;
		throw new Error(`unexpected invoke: ${cmd}`);
	};

	assert.equal(await session.ensureFullContent(tab.id), true);
	assert.equal(tab.rawContent, FULL);
	assert.notEqual(tab.isTruncated, true);

	assert.equal(await session.saveContent(tab.id), true);
	const write = invokeCalls.find((call) => call.cmd === 'save_file_content');
	assert.equal(write?.args.content, FULL);
});

test('completing a buffer that is already whole does not re-read the file', async () => {
	reset();
	handleInvoke = (cmd) => {
		if (cmd === 'open_markdown_preview') return ['<p>full</p>', FULL, true, false];
		throw new Error(`unexpected invoke: ${cmd}`);
	};
	const session = makeSession();
	await session.loadMarkdown('/docs/small.md');
	const before = invokeCalls.length;

	assert.equal(await session.ensureFullContent(tabManager.activeTabId!), true);
	assert.equal(invokeCalls.length, before);
});

test('a partial buffer that already carries edits is never silently discarded', async () => {
	reset();
	const { session, tab } = await openPartial();
	// Should be unreachable now that every editing entry point completes the
	// buffer first, but if it ever happens the fix must not trade one kind of
	// data loss for another.
	tabManager.updateTabRawContent(tab.id, `${PARTIAL}edited`);

	handleInvoke = (cmd) => {
		if (cmd === 'read_file_content_checked') return [FULL, false];
		throw new Error(`unexpected invoke: ${cmd}`);
	};

	assert.equal(await session.ensureFullContent(tab.id), false);
	assert.equal(tab.rawContent, `${PARTIAL}edited`);
	assert.equal(await session.saveContent(tab.id), false);
});

test('a load into an editable pane reads the whole file instead of the preview slice', async () => {
	// F5 / "reload from disk" preserves edit state. Taking the preview
	// shortcut there hands the editor a partial buffer, and the next keystroke
	// arms auto-save on it.
	reset();
	handleInvoke = (cmd) => {
		if (cmd === 'open_markdown_preview') return ['<p>preview</p>', PARTIAL, false, false];
		if (cmd === 'read_file_content_checked') return [FULL, false];
		throw new Error(`unexpected invoke: ${cmd}`);
	};
	tabManager.addTab('/docs/big.md', '');
	const tab = tabManager.activeTab!;
	tab.isEditing = true;
	const session = makeSession();

	await session.loadMarkdown('/docs/big.md', { preserveEditState: true, skipTabManagement: true });

	assert.equal(tab.rawContent, FULL);
	assert.notEqual(tab.isTruncated, true);
	assert.equal(
		invokeCalls.some((call) => call.cmd === 'open_markdown_preview'),
		false,
	);
});

test('toggling a task checkbox completes the buffer before writing it', async () => {
	reset();
	const doc = `- [ ] first\n\n${'y'.repeat(PREVIEW_BYTES)}\n\n- [ ] last\n`;
	const partial = doc.slice(0, PREVIEW_BYTES);
	handleInvoke = (cmd) => {
		if (cmd === 'open_markdown_preview') return ['<p>preview</p>', partial, false, false];
		if (cmd === 'read_file_content_checked') return new Promise(() => {});
		throw new Error(`unexpected invoke: ${cmd}`);
	};
	const session = makeSession();
	await session.loadMarkdown('/docs/tasks.md');
	const tab = tabManager.activeTab!;
	assert.equal(tab.rawContent, partial);

	handleInvoke = (cmd) => {
		if (cmd === 'read_file_content_checked') return [doc, false];
		if (cmd === 'save_file_content') return null;
		throw new Error(`unexpected invoke: ${cmd}`);
	};
	await session.toggleTaskCheckbox(1, true);

	const write = invokeCalls.find((call) => call.cmd === 'save_file_content');
	assert.ok(write, 'the checkbox toggle still saves');
	assert.equal(write!.args.content, doc.replace('- [ ] first', '- [x] first'));
	assert.ok(
		(write!.args.content as string).includes('- [ ] last'),
		'the part of the file past the preview window survives',
	);
});

// --- wiring that cannot be executed outside a Svelte runtime ---

test('entering split view completes a partial buffer instead of trusting it', () => {
	// The old guard was `!tab.rawContent`, which a partial buffer satisfies:
	// split view opened on the truncated text, the first keystroke made it
	// dirty, and auto-save wrote it back 1.5s later.
	const enter = sliceBetween(viewer, 'async function toggleSplitView', '} else {');
	assert.match(enter, /ensureFullContent/);
	// And it has to stop when the buffer could not be completed, rather than
	// opening an editor over the partial text anyway.
	assert.match(enter, /if \(!\(await documentSession\.ensureFullContent\(tab\.id\)\)\) \{[\s\S]*?return;/);
	// The empty-buffer read must go through the store so the tab does not keep
	// a stale "partial" flag that would then block every save.
	assert.match(enter, /tabManager\.setTabRawContent\(tab\.id, content\)/);
});

test('a partial buffer cannot be handed to another window', () => {
	// The destination rebuilds the tab from the payload alone and has no way
	// to know the text is incomplete, so its auto-save would truncate the file.
	const canTransfer = sliceBetween(viewer, 'canTransfer: (tabId)', 'transferPayload:');
	assert.match(canTransfer, /isTruncated/);
	const detach = sliceBetween(viewer, 'async function handleDetach', 'async function carryActiveTabToNextWindow');
	assert.match(detach, /ensureFullContent/);
});

test('front matter edits in preview mode complete the buffer first', () => {
	for (const entry of ['async function handleFrontMatterEdit', 'async function handleFrontMatterListChange']) {
		// One handler is followed by a `function`, the other by an `async
		// function`, so the slice ends at whichever comes first. The previous
		// expression was `indexOf(a) + 1 || indexOf(b) + 1`, which reads as
		// "or else" but is really "or else, if the first is absent *or at
		// offset 0*" — and when the first form appeared later in the file than
		// the second it won anyway, widening the body past the handler and
		// letting a neighbouring function satisfy the `assert.match` below.
		const handler = sliceFrom(viewer, entry);
		const ends = ['\n\tfunction ', '\n\tasync function ']
			.map((marker) => handler.indexOf(marker))
			.filter((at) => at !== -1);
		assert.ok(ends.length > 0, `${entry} must be followed by a declaration that bounds it`);
		const body = handler.slice(0, Math.min(...ends));
		assert.match(body, /ensureFullContent/, `${entry} must not edit a partial buffer`);
	}
});
