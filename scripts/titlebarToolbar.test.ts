import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	DEFAULT_TITLEBAR_TOOLBAR_ORDER,
	getConfiguredTitlebarToolbarIds,
	getTitlebarToolbarAdjacentMove,
	getTitlebarToolbarReorderMove,
	normalizeTitlebarToolbarHidden,
	normalizeTitlebarToolbarOrder,
	normalizeTitlebarToolbarPlacement,
} from '../src/lib/utils/titlebarToolbar.js';

test('normalizeTitlebarToolbarOrder drops unknown ids, deduplicates, and appends defaults', () => {
	assert.deepEqual(
		normalizeTitlebarToolbarOrder([
			'settings',
			'unknown-action',
			'reload',
			'settings',
		]),
		[
			'settings',
			'reload',
			...DEFAULT_TITLEBAR_TOOLBAR_ORDER.filter((id) => id !== 'settings' && id !== 'reload'),
		],
	);
});

test('normalizeTitlebarToolbarHidden keeps only known optional actions', () => {
	assert.deepEqual(
		normalizeTitlebarToolbarHidden(['reload', 'settings', 'unknown-action', 'find']),
		['reload', 'find'],
	);
});

test('normalizeTitlebarToolbarPlacement keeps known bar and menu values', () => {
	const placement = normalizeTitlebarToolbarPlacement({
		reload: 'menu',
		find: 'bar',
		settings: 'bar',
		unknown: 'bar',
		edit: 'hidden',
	});

	assert.equal(placement.reload, 'menu');
	assert.equal(placement.find, 'bar');
	assert.equal(placement.settings, 'bar');
	assert.equal(placement.edit, 'bar');
	assert.equal('unknown' in placement, false);
});

test('getConfiguredTitlebarToolbarIds applies context, order, hidden ids, and placement', () => {
	const configured = getConfiguredTitlebarToolbarIds(
		['back', 'forward', 'reload', 'find', 'settings', 'open_loc'],
		['settings', 'find', 'reload', 'back', 'forward'],
		['forward'],
		{ find: 'bar', reload: 'menu', settings: 'menu' },
	);

	assert.deepEqual(configured.visibleIds, ['settings', 'find', 'reload', 'back']);
	assert.deepEqual(configured.barIds, ['find', 'back']);
	assert.deepEqual(configured.menuIds, ['settings', 'reload']);
});

test('titlebar toolbar reorder helpers resolve drag and keyboard moves', () => {
	const order = ['back', 'reload', 'settings'];

	assert.deepEqual(getTitlebarToolbarReorderMove(order, 'settings', 'back'), { fromIndex: 2, toIndex: 0 });
	assert.deepEqual(getTitlebarToolbarAdjacentMove(order, 'reload', 'down'), { fromIndex: 1, toIndex: 2 });
	assert.equal(getTitlebarToolbarReorderMove(order, 'back', 'back'), null);
	assert.equal(getTitlebarToolbarAdjacentMove(order, 'back', 'up'), null);
});
