import assert from 'node:assert/strict';
import test from 'node:test';

// The home screen used to sit in a tab, and that tab's path was the sentinel
// string `'HOME'` rather than a file. `serializeState` filtered on
// `path !== ''`, so the sentinel was written into the session snapshot;
// `restoreState` accepted any non-empty string, so it came back; and startup
// then asked the backend to read a file called `HOME`. The failure left a
// phantom tab that can never be read, and a window whose only tab was the home
// screen came back empty.
//
// `hasRealFilePath` in utils/tabFileActions.ts is the project's existing answer
// to "is this path a file" — every other caller already used it.
//
// These tests drive the real TabManager, so they lock the behaviour rather than
// the wording. The restore-loop half lives in sessionRestoreResilience.test.ts,
// which already has the window-session harness.

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
g.window.__TAURI_INTERNALS__ = {
	metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
	invoke: (cmd: string) => Promise.resolve(cmd === 'get_os_type' ? 'macos' : null),
};

const { tabManager } = await import('../src/lib/stores/tabs.svelte.js');
const { HOME_TAB_PATH } = await import('../src/lib/utils/homeTab.js');

function reset() {
	tabManager.closeAll();
	localStore.clear();
}

/**
 * A tab bearing the home sentinel.
 *
 * `TabManager.addHomeTab` used to build one; it lost its last caller when
 * Ctrl+T settled on "new file" (#480) and was removed with it. The write-side
 * rule it exercised here outlives it, because the two sides are one filter:
 * `serializeState` and `restoreState` both reject on `hasRealFilePath`, and the
 * read side still meets `HOME` in snapshots this app wrote before the fix.
 * Pinning the write side is what keeps a future writer from putting the
 * sentinel back into the file the read side is busy defending against.
 */
function openHomeTab() {
	tabManager.addNewTab();
	tabManager.activeTab!.path = HOME_TAB_PATH;
}

test('a session snapshot never carries the home tab', () => {
	reset();
	tabManager.addTab('/notes/a.md');
	openHomeTab();

	const snapshot = JSON.parse(tabManager.serializeState());

	assert.deepEqual(
		snapshot.tabs.map((tab: { path: string }) => tab.path),
		['/notes/a.md'],
	);
});

test('a window showing only the home tab writes an empty snapshot, not a HOME one', () => {
	reset();
	openHomeTab();

	assert.deepEqual(JSON.parse(tabManager.serializeState()).tabs, []);
});

test('untitled tabs are still excluded from the snapshot', () => {
	// The filter this changes also carried the untitled rule; keep it honest.
	reset();
	tabManager.addTab('/notes/a.md');
	tabManager.addNewTab();

	assert.deepEqual(
		JSON.parse(tabManager.serializeState()).tabs.map((tab: { path: string }) => tab.path),
		['/notes/a.md'],
	);
});

test('a HOME entry in an older snapshot is not restored as a tab', () => {
	reset();
	// Builds before this fix wrote the sentinel into the snapshot, and those
	// snapshots are already on users' disks — so the read side has to reject it
	// too, not just the write side.
	tabManager.restoreState(
		JSON.stringify({
			version: 2,
			activeTabId: 'home-id',
			tabs: [
				{ id: 'home-id', path: 'HOME', title: 'Home' },
				{ id: 'doc-id', path: '/notes/a.md', title: 'a.md' },
			],
		}),
	);

	assert.deepEqual(
		tabManager.tabs.map((tab) => tab.path),
		['/notes/a.md'],
	);
	// The stale active id pointed at the rejected entry; the window must not
	// come back with nothing selected.
	assert.equal(tabManager.activeTabId, tabManager.tabs[0].id);
});

test('a snapshot of nothing but HOME restores no tabs at all', () => {
	reset();
	tabManager.restoreState(
		JSON.stringify({ version: 2, activeTabId: 'home-id', tabs: [{ id: 'home-id', path: 'HOME', title: 'Home' }] }),
	);

	assert.deepEqual(tabManager.tabs, []);
	assert.equal(tabManager.activeTabId, null);
});
