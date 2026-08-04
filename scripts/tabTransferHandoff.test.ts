import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource, sliceBetween, sliceFrom } from './sourceTree.js';

const session = readSource(new URL('../src/lib/sessions/windowSession.svelte.ts', import.meta.url));
const viewer = readSource(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url));
const broker = readSource(new URL('../src-tauri/src/tab_transfer.rs', import.meta.url));

// A tab transfer is only ever allowed to end in one of two states: the source
// still has the tab, or the destination does. Every defect below produced the
// third state -- present in both windows, each with its own auto-save timer
// writing over the other.

test('the source keeps waiting when the destination has already claimed', () => {
	// The 15s timeout is a guess about a window that may simply be slow to
	// render. Cancelling regardless is what stranded a copy on each side.
	const cancel = sliceFrom(session, 'const cancel = async ()');
	assert.match(cancel, /outcome\.cancelled/);
	assert.match(cancel, /outcome\.claimed/);
	assert.match(cancel, /if \(!outcome\.cancelled && outcome\.claimed\) return;/);
});

test('the destination releases its claim when it cannot finish', () => {
	// Because a claimed transfer is immune to the source's timeout, the
	// destination is the only party that can end a claim it cannot complete.
	assert.match(session, /async function releaseClaim\(token: string\)/);
	const accept = sliceBetween(session, 'async function acceptOfferedTransfer', 'async function claimTransferredTab');
	// Invalid payload, a refusing destination, and a thrown render all release.
	assert.equal((accept.match(/releaseClaim\(token\)/g) ?? []).length, 3);
	assert.match(accept, /if \(claimed\) await releaseClaim\(token\);/);
});

test('a claim is distinguished from "no such token"', () => {
	// Releasing a token that was never claimed would be a no-op at best and a
	// cancel of someone else's transfer at worst.
	const accept = sliceBetween(session, 'async function acceptOfferedTransfer', 'async function claimTransferredTab');
	assert.match(accept, /if \(payload === null\)/);
	assert.match(accept, /claimed = true;/);
});

test('a failed render undoes the inserted tab', () => {
	// The tab must exist before it can be rendered, so the destination owns a
	// document the source still shows until the render succeeds.
	const accept = sliceBetween(viewer, 'acceptTransferredTab: async (snapshot)', 'onError: (message, error)');
	assert.match(accept, /\} catch \(error\) \{\s*\n\s*tabManager\.closeTab\(id\);\s*\n\s*throw error;/);
	assert.match(accept, /if \(isDisposed\) \{\s*\n\s*tabManager\.closeTab\(id\);/);
});

test('a second transfer of the same tab is refused while one is in flight', () => {
	// The menu entry becomes clickable again long before the transfer
	// resolves; two payloads for one tab means two windows each build it.
	assert.match(session, /const transfersInFlight = new Set<string>\(\);/);
	assert.match(session, /if \(transfersInFlight\.has\(tabId\)\) return false;/);
	assert.match(session, /\} finally \{\s*\n\s*transfersInFlight\.delete\(tabId\);/);
});

test('the broker binds every operation to the window that may perform it', () => {
	// Tokens used to be t1..t16, and any webview could read or destroy any
	// staged transfer -- including the document text of a drag in progress.
	assert.match(broker, /fn is_destination_label/);
	assert.match(broker, /enum CancelAuthority/);
	assert.doesNotMatch(broker, /format!\("t\{\}"/);
});

test('eviction never drops a transfer that is mid-handoff', () => {
	assert.match(broker, /fn eviction_victim/);
	assert.match(broker, /claimed_at/);
});
