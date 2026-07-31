import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	DEFAULT_PREVIEW_MAX_WIDTH,
	MAX_PREVIEW_MAX_WIDTH,
	MIN_PREVIEW_MAX_WIDTH,
	normalizePreviewMaxWidth,
} from '../src/lib/utils/previewWidth.js';

const settingsSource = readFileSync(new URL('../src/lib/stores/settings.svelte.ts', import.meta.url), 'utf8');

test('preview width defaults and clamps persisted numeric values', () => {
	assert.equal(DEFAULT_PREVIEW_MAX_WIDTH, 880);
	assert.equal(normalizePreviewMaxWidth(null), DEFAULT_PREVIEW_MAX_WIDTH);
	assert.equal(normalizePreviewMaxWidth('not-a-number'), DEFAULT_PREVIEW_MAX_WIDTH);
	assert.equal(normalizePreviewMaxWidth('639'), MIN_PREVIEW_MAX_WIDTH);
	assert.equal(normalizePreviewMaxWidth('1601'), MAX_PREVIEW_MAX_WIDTH);
	assert.equal(normalizePreviewMaxWidth('921.8'), 922);
});

test('preview width accepts only finite numeric values', () => {
	assert.equal(normalizePreviewMaxWidth(Number.NaN), DEFAULT_PREVIEW_MAX_WIDTH);
	assert.equal(normalizePreviewMaxWidth(Number.POSITIVE_INFINITY), DEFAULT_PREVIEW_MAX_WIDTH);
	assert.equal(normalizePreviewMaxWidth(1200), 1200);
});

test('settings load, persist, and reset the preview width through one normalizer', () => {
	assert.match(settingsSource, /previewMaxWidth = \$state\(DEFAULT_PREVIEW_MAX_WIDTH\)/);
	assert.match(settingsSource, /localStorage\.getItem\('preview\.maxWidth'\)/);
	assert.match(settingsSource, /normalizePreviewMaxWidth\(savedPreviewMaxWidth\)/);
	assert.match(settingsSource, /localStorage\.setItem\('preview\.maxWidth', String\(this\.previewMaxWidth\)\)/);
	assert.match(settingsSource, /resetPreviewMaxWidth\(\)[\s\S]*this\.previewMaxWidth = DEFAULT_PREVIEW_MAX_WIDTH/);
});
