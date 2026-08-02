import assert from 'node:assert/strict';
import test from 'node:test';

// Startup restore is a data-safety path: the snapshot is the only record of
// which documents the user had open. Two ways it used to destroy that record:
//
// 1. A file that could not be read had its tab dropped, and the trimmed list
//    was written straight back to disk. A share that was down for a minute, a
//    drive that was not plugged in, a file another program had locked — the
//    tab was gone for good.
// 2. A restore that never finished left a breadcrumb, and the next launch
//    reacted by deleting the whole snapshot. One document took the session
//    down with it.
//
// These tests drive the real window session and the real TabManager against a
// stubbed Tauri bridge and a stubbed localStorage, so they lock the behaviour
// rather than the wording. What they cannot cover is the renderer actually
// dying mid-restore; an interrupted launch is simulated by leaving behind
// exactly the breadcrumb such a launch leaves.

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

const localStore = new Map<string, string>();
g.localStorage = {
	getItem: (key: string) => (localStore.has(key) ? localStore.get(key)! : null),
	setItem: (key: string, value: string) => void localStore.set(key, String(value)),
	removeItem: (key: string) => void localStore.delete(key),
	clear: () => localStore.clear(),
};

const WINDOW_STATE_KEY = 'savedTabsDataV2';
const LEGACY_STATE_KEY = 'savedTabsData';
const RESTORE_IN_PROGRESS_KEY = 'markpad-window-restore-in-progress';

let invokeCalls: Array<{ cmd: string; args: any }> = [];
/** The window-state file the Rust side holds. */
let storedSnapshot: string | null = null;
/** Files the backend can read; anything else fails the way a real read does. */
let disk = new Map<string, string>();
/** Paths whose read should fail even though the file "exists". */
let unreadable = new Set<string>();
/** Called just before each read, to observe the breadcrumb mid-restore. */
let onRead: (path: string) => void = () => {};

g.window.__TAURI_INTERNALS__ = {
	metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
	invoke: (cmd: string, args: any) => {
		invokeCalls.push({ cmd, args });
		switch (cmd) {
			case 'get_os_type':
				return Promise.resolve('macos');
			case 'load_window_state':
				return Promise.resolve(storedSnapshot);
			case 'save_window_state':
				storedSnapshot = args.json;
				return Promise.resolve(null);
			case 'clear_window_state':
				storedSnapshot = null;
				return Promise.resolve(null);
			case 'read_file_content_checked': {
				onRead(args.path);
				if (unreadable.has(args.path) || !disk.has(args.path)) {
					return Promise.reject(new Error(`cannot read ${args.path}`));
				}
				return Promise.resolve([disk.get(args.path), false]);
			}
			default:
				return Promise.resolve(null);
		}
	},
};

const { tabManager } = await import('../src/lib/stores/tabs.svelte.js');
const { createWindowSession } = await import('../src/lib/sessions/windowSession.svelte.js');

const warnings: string[] = [];
const errors: string[] = [];

function makeSession() {
	return createWindowSession({
		isMainWindow: true,
		windowStateKey: WINDOW_STATE_KEY,
		legacyStateKey: LEGACY_STATE_KEY,
		restoreInProgressKey: RESTORE_IN_PROGRESS_KEY,
		serializeState: () => tabManager.serializeState(),
		shouldRestoreState: () => true,
		isDisposed: () => false,
		restoreState: (json) => tabManager.restoreState(json),
		restoredTabs: () => tabManager.tabs.map((tab) => ({ id: tab.id, path: tab.path })),
		applyRestoredContent: async (tabId, raw) => {
			const tab = tabManager.tabs.find((item) => item.id === tabId);
			if (!tab) return;
			tab.rawContent = raw;
			tab.originalContent = raw;
		},
		dropRestoredTab: (tabId) => tabManager.closeTab(tabId),
		canTransfer: () => true,
		canDetach: () => true,
		transferPayload: () => '',
		onTransferClaimed: () => {},
		acceptTransferredTab: async () => true,
		onError: (message) => errors.push(message),
		onWarning: (message) => warnings.push(message),
	});
}

function snapshotOf(paths: string[]): string {
	return JSON.stringify({
		version: 2,
		activeTabId: null,
		tabs: paths.map((path, index) => ({ id: `tab-${index}`, path, title: path })),
	});
}

function reset(paths: string[], contents: Record<string, string> = {}) {
	tabManager.closeAll();
	tabManager.recentlyClosed.length = 0;
	localStore.clear();
	invokeCalls = [];
	warnings.length = 0;
	errors.length = 0;
	unreadable = new Set();
	onRead = () => {};
	disk = new Map(paths.map((path) => [path, contents[path] ?? `# ${path}`]));
	storedSnapshot = snapshotOf(paths);
}

function breadcrumb(): any {
	const raw = localStore.get(RESTORE_IN_PROGRESS_KEY);
	return raw === undefined ? null : JSON.parse(raw);
}

function persistedPaths(): string[] {
	return storedSnapshot ? JSON.parse(storedSnapshot).tabs.map((tab: { path: string }) => tab.path) : [];
}

const readsOf = () => invokeCalls.filter((call) => call.cmd === 'read_file_content_checked').map((call) => call.args.path);

// --- a read that fails is not a decision to close the document ---

test('a file that cannot be read keeps its tab', async () => {
	reset(['/a.md', '/away.md', '/c.md']);
	unreadable.add('/away.md');

	await makeSession().restore();

	assert.deepEqual(
		tabManager.tabs.map((tab) => tab.path),
		['/a.md', '/away.md', '/c.md'],
	);
	assert.ok(
		warnings.some((message) => message.includes('could not be read')),
		'the failure is reported, not silent',
	);
});

test('the failed read is not written back into the snapshot', async () => {
	reset(['/a.md', '/away.md']);
	unreadable.add('/away.md');

	await makeSession().restore();

	// This is the whole bug: the trimmed list used to be persisted right after
	// the loop, so the tab never came back even once the drive was plugged in.
	assert.deepEqual(persistedPaths(), ['/a.md', '/away.md']);
});

test('the empty buffer of an unreadable tab is flagged so nothing can save it over the file', async () => {
	reset(['/away.md']);
	unreadable.add('/away.md');

	await makeSession().restore();

	const tab = tabManager.tabs[0];
	assert.equal(tab.rawContent, '');
	assert.equal(tab.isDirty, false);
	// `isTruncated` is the existing "this buffer is not the whole file" flag:
	// every writer already refuses it and `ensureFullContent` re-reads the file
	// the next time the tab is opened for editing.
	assert.equal(tab.isTruncated, true);
});

test('the documents that did read are restored normally', async () => {
	reset(['/a.md', '/away.md'], { '/a.md': '# hello' });
	unreadable.add('/away.md');

	await makeSession().restore();

	const readable = tabManager.tabs.find((tab) => tab.path === '/a.md')!;
	assert.equal(readable.rawContent, '# hello');
	assert.notEqual(readable.isTruncated, true);
});

// --- an interrupted restore costs one document, not the session ---

test('an interrupted restore names the document it was on', async () => {
	reset(['/a.md', '/big.md', '/c.md']);
	const seen: Array<string | null> = [];
	onRead = () => seen.push(breadcrumb()?.pending ?? null);

	await makeSession().restore();

	// The breadcrumb has to be updated per document; a flag that only says "a
	// restore was running" cannot tell the next launch what to skip.
	assert.deepEqual(seen, ['/a.md', '/big.md', '/c.md']);
});

test('the launch after an interruption restores everything except the suspect', async () => {
	reset(['/a.md', '/big.md', '/c.md']);
	localStore.set(
		RESTORE_IN_PROGRESS_KEY,
		JSON.stringify({ running: true, pending: '/big.md', deferred: [], interruptions: 0 }),
	);

	await makeSession().restore();

	assert.deepEqual(readsOf(), ['/a.md', '/c.md'], 'the suspect is not read again');
	assert.deepEqual(
		tabManager.tabs.map((tab) => tab.path),
		['/a.md', '/big.md', '/c.md'],
		'every tab is still there, including the deferred one',
	);
	assert.deepEqual(persistedPaths(), ['/a.md', '/big.md', '/c.md']);
	assert.equal(storedSnapshot !== null, true, 'the snapshot is never discarded');
	assert.equal(
		invokeCalls.some((call) => call.cmd === 'clear_window_state'),
		false,
	);
});

test('a breadcrumb from an older build no longer wipes the session', async () => {
	reset(['/a.md', '/b.md']);
	// Pre-fix builds wrote the string 'true' and the next launch deleted the
	// entire snapshot on sight.
	localStore.set(RESTORE_IN_PROGRESS_KEY, 'true');

	await makeSession().restore();

	assert.deepEqual(
		tabManager.tabs.map((tab) => tab.path),
		['/a.md', '/b.md'],
	);
	assert.equal(
		invokeCalls.some((call) => call.cmd === 'clear_window_state'),
		false,
	);
	// It names no suspect, so it costs one retry rather than one document.
	assert.deepEqual(readsOf(), ['/a.md', '/b.md']);
});

test('a finished restore leaves no breadcrumb behind', async () => {
	reset(['/a.md']);

	await makeSession().restore();

	assert.equal(breadcrumb(), null);
});

test('deferrals accumulate one document per interruption instead of retrying forever', async () => {
	reset(['/a.md', '/one.md', '/two.md']);
	localStore.set(
		RESTORE_IN_PROGRESS_KEY,
		JSON.stringify({ running: true, pending: '/one.md', deferred: [], interruptions: 0 }),
	);
	await makeSession().restore();
	assert.deepEqual(breadcrumb().deferred, ['/one.md']);

	// The next launch dies on a different document.
	reset(['/a.md', '/one.md', '/two.md']);
	localStore.set(
		RESTORE_IN_PROGRESS_KEY,
		JSON.stringify({ running: true, pending: '/two.md', deferred: ['/one.md'], interruptions: 1 }),
	);

	await makeSession().restore();

	assert.deepEqual(readsOf(), ['/a.md']);
	assert.deepEqual(
		tabManager.tabs.map((tab) => tab.path),
		['/a.md', '/one.md', '/two.md'],
	);
	assert.deepEqual(breadcrumb().deferred, ['/one.md', '/two.md']);
});

test('after repeated interruptions startup stops reading but still hands back every tab', async () => {
	reset(['/a.md', '/b.md', '/c.md']);
	localStore.set(
		RESTORE_IN_PROGRESS_KEY,
		JSON.stringify({ running: true, pending: null, deferred: [], interruptions: 2 }),
	);

	await makeSession().restore();

	assert.deepEqual(readsOf(), [], 'a third interrupted launch stops opening documents by itself');
	assert.deepEqual(
		tabManager.tabs.map((tab) => tab.path),
		['/a.md', '/b.md', '/c.md'],
	);
	assert.deepEqual(persistedPaths(), ['/a.md', '/b.md', '/c.md']);
	for (const tab of tabManager.tabs) assert.equal(tab.isTruncated, true);
});

// --- the HOME sentinel never reaches the backend ---

test('a HOME entry in an older snapshot is never read as a file', async () => {
	reset(['/a.md']);
	storedSnapshot = snapshotOf(['HOME', '/a.md']);

	await makeSession().restore();

	// A sentinel is not a file that might come back later, so it is dropped
	// rather than kept as an unreadable tab.
	assert.equal(readsOf().includes('HOME'), false);
	assert.deepEqual(
		tabManager.tabs.map((tab) => tab.path),
		['/a.md'],
	);
	assert.deepEqual(persistedPaths(), ['/a.md']);
});

test('a snapshot of nothing but HOME does not cost the window its session', async () => {
	reset([]);
	storedSnapshot = snapshotOf(['HOME']);

	await makeSession().restore();

	assert.deepEqual(tabManager.tabs, []);
	assert.equal(
		invokeCalls.some((call) => call.cmd === 'read_file_content_checked'),
		false,
	);
});

test('a deferred document is released once Markpad has read it', async () => {
	reset(['/a.md', '/big.md']);
	localStore.set(
		RESTORE_IN_PROGRESS_KEY,
		JSON.stringify({ running: true, pending: '/big.md', deferred: [], interruptions: 0 }),
	);
	const session = makeSession();
	await session.restore();
	assert.deepEqual(breadcrumb().deferred, ['/big.md']);

	// The user opens it by hand and nothing goes wrong.
	const deferredTab = tabManager.tabs.find((tab) => tab.path === '/big.md')!;
	tabManager.setTabRawContent(deferredTab.id, '# big');

	await session.persistState();

	assert.equal(breadcrumb(), null, 'the deferral is not permanent');
});
