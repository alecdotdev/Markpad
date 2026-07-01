import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DEFAULT_EDITOR_TOOLBAR_ORDER,
	getEditorToolbarAdjacentMove,
	getEditorToolbarReorderMove,
	getVisibleEditorToolbarTools,
	normalizeEditorToolbarHidden,
	normalizeEditorToolbarOrder,
} from '../src/lib/utils/editorToolbar.js';

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
	assert.equal(tools.length, DEFAULT_EDITOR_TOOLBAR_ORDER.length - 1);
});

test('toolbar reorder helpers resolve drag and keyboard moves', () => {
	const order = ['fmt-bold', 'fmt-italic', 'fmt-link'];

	assert.deepEqual(getEditorToolbarReorderMove(order, 'fmt-link', 'fmt-bold'), { fromIndex: 2, toIndex: 0 });
	assert.deepEqual(getEditorToolbarAdjacentMove(order, 'fmt-italic', 'down'), { fromIndex: 1, toIndex: 2 });
	assert.equal(getEditorToolbarReorderMove(order, 'fmt-bold', 'fmt-bold'), null);
	assert.equal(getEditorToolbarAdjacentMove(order, 'fmt-bold', 'up'), null);
});
