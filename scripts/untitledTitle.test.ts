import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { nextUntitledTitle } from '../src/lib/utils/untitledTitle.js';

// Untitled tabs get distinct numbered titles ("Untitled 1", "Untitled 2", …)
// so the tab strip — and the per-tab close dialogs — can name exactly which
// tab they are talking about. Two dirty untitled tabs used to both be called
// "Untitled", making the close dialog ambiguous.

test('the first untitled tab is number 1', () => {
	assert.equal(nextUntitledTitle([], 'Untitled'), 'Untitled 1');
});

test('numbers increment past the ones in use', () => {
	assert.equal(nextUntitledTitle(['Untitled 1', 'Untitled 2'], 'Untitled'), 'Untitled 3');
});

test('freed numbers are reused (smallest available wins)', () => {
	assert.equal(nextUntitledTitle(['Untitled 1', 'Untitled 3'], 'Untitled'), 'Untitled 2');
});

test('a legacy unnumbered title occupies slot 1', () => {
	assert.equal(nextUntitledTitle(['Untitled'], 'Untitled'), 'Untitled 2');
});

test('titled tabs and lookalike names are ignored', () => {
	assert.equal(
		nextUntitledTitle(['notes.md', 'Untitled draft', 'Untitled 1x'], 'Untitled'),
		'Untitled 1',
	);
});

test('works with localized bases', () => {
	assert.equal(nextUntitledTitle(['无标题 1'], '无标题'), '无标题 2');
});

test('new tabs are created with numbered untitled titles', () => {
	const tabs = readFileSync('src/lib/stores/tabs.svelte.ts', 'utf8');
	assert.match(tabs, /nextUntitledTitle\(/);
	// both creation paths go through the helper
	const addNewTab = tabs.slice(tabs.indexOf('addNewTab()'), tabs.indexOf('addHomeTab()'));
	assert.match(addNewTab, /nextUntitledTitle\(/);
});
