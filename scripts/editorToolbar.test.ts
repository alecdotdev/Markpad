import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DEFAULT_EDITOR_TOOLBAR_ORDER,
	getEditorToolbarAdjacentMove,
	getEditorToolbarReorderMove,
	getEditorToolbarTools,
	getVisibleEditorToolbarTools,
	normalizeEditorToolbarHidden,
	normalizeEditorToolbarOrder,
} from '../src/lib/utils/editorToolbar.js';

/**
 * `DEFAULT_EDITOR_TOOLBAR_ORDER` is `EDITOR_TOOLBAR_TOOLS.map((tool) => tool.id)`,
 * so an expected value written in terms of it says nothing about what is in the
 * catalogue: deleting the Underline tool outright left every assertion in this
 * file green. The two tests below are the ones that hold the catalogue still —
 * the same job `titlebarToolbar.test.ts` does with its literal id lists — and
 * the derived expectations above are then free to describe the *reordering*,
 * which is what they are actually about.
 */
test('the default order is the whole tool catalogue, in the order the toolbar renders it', () => {
	assert.deepEqual(DEFAULT_EDITOR_TOOLBAR_ORDER, [
		'fmt-bold',
		'fmt-italic',
		'fmt-underline',
		'fmt-inline-code',
		'fmt-code-block',
		'fmt-quote',
		'fmt-heading-1',
		'fmt-heading-2',
		'fmt-heading-3',
		'fmt-bullet-list',
		'fmt-numbered-list',
		'fmt-checklist',
		'fmt-link',
		'insert-table-simple',
	]);
});

test('each tool carries the label, name and shortcut the toolbar renders', () => {
	const byId = new Map(getEditorToolbarTools(null).map((tool) => [tool.id, tool]));

	assert.deepEqual(
		getEditorToolbarTools(null)
			.filter((tool) => tool.group === 'inline')
			.map((tool) => tool.id),
		['fmt-bold', 'fmt-italic', 'fmt-underline', 'fmt-inline-code'],
	);

	// The three tools whose accelerator the editor also binds; a tool that
	// loses its shortcut still renders, so nothing else would notice.
	assert.equal(byId.get('fmt-bold')?.shortcut?.('Ctrl'), 'Ctrl+B');
	assert.equal(byId.get('fmt-italic')?.shortcut?.('Cmd'), 'Cmd+I');
	assert.equal(byId.get('fmt-underline')?.shortcut?.('Ctrl'), 'Ctrl+U');
	assert.equal(byId.get('fmt-underline')?.label, 'U');
	assert.equal(byId.get('fmt-underline')?.name, 'Underline');
	assert.equal(byId.get('insert-table-simple')?.shortcut?.('Cmd'), 'Cmd+K T');
});

test('normalizeEditorToolbarOrder drops unknown ids, deduplicates, and appends new defaults', () => {
	assert.deepEqual(
		normalizeEditorToolbarOrder([
			'fmt-heading-1',
			'unknown-tool',
			'fmt-bold',
			'fmt-heading-1',
		]),
		[
			'fmt-heading-1',
			'fmt-bold',
			...DEFAULT_EDITOR_TOOLBAR_ORDER.filter((id) => id !== 'fmt-heading-1' && id !== 'fmt-bold'),
		],
	);
});

test('normalizeEditorToolbarHidden keeps only known toolbar ids', () => {
	assert.deepEqual(
		normalizeEditorToolbarHidden(['fmt-bold', 'unknown-tool', 'fmt-italic']),
		['fmt-bold', 'fmt-italic'],
	);
});

test('getVisibleEditorToolbarTools applies saved order and hidden ids', () => {
	const tools = getVisibleEditorToolbarTools(['fmt-italic', 'fmt-bold'], ['fmt-bold']);

	assert.equal(tools[0]?.id, 'fmt-italic');
	assert.equal(tools.some((tool) => tool.id === 'fmt-bold'), false);
	// 14 tools in the catalogue, one hidden. Counted rather than derived from
	// the default order: `DEFAULT_EDITOR_TOOLBAR_ORDER.length - 1` shrinks with
	// the catalogue and stays true.
	assert.equal(tools.length, 13);
});

test('toolbar reorder helpers resolve drag and keyboard moves', () => {
	const order = ['fmt-bold', 'fmt-italic', 'fmt-link'];

	assert.deepEqual(getEditorToolbarReorderMove(order, 'fmt-link', 'fmt-bold'), { fromIndex: 2, toIndex: 0 });
	assert.deepEqual(getEditorToolbarAdjacentMove(order, 'fmt-italic', 'down'), { fromIndex: 1, toIndex: 2 });
	assert.equal(getEditorToolbarReorderMove(order, 'fmt-bold', 'fmt-bold'), null);
	assert.equal(getEditorToolbarAdjacentMove(order, 'fmt-bold', 'up'), null);
});
