import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	DEFAULT_PREVIEW_MAX_WIDTH,
	getPreviewContentWidth,
	MAX_PREVIEW_MAX_WIDTH,
	MIN_PREVIEW_MAX_WIDTH,
	normalizePreviewMaxWidth,
} from '../src/lib/utils/previewWidth.js';

const settingsSource = readFileSync(new URL('../src/lib/stores/settings.svelte.ts', import.meta.url), 'utf8');
const viewerSource = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');
const settingsComponentSource = readFileSync(new URL('../src/lib/components/Settings.svelte', import.meta.url), 'utf8');

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

test('full mode has no configured content-width cap', () => {
	assert.equal(getPreviewContentWidth(1200, false), 1200);
	assert.equal(getPreviewContentWidth(1200, true), null);
});

test('settings load, persist, and reset the preview width through one normalizer', () => {
	assert.match(settingsSource, /previewMaxWidth = \$state\(DEFAULT_PREVIEW_MAX_WIDTH\)/);
	assert.match(settingsSource, /localStorage\.getItem\('preview\.maxWidth'\)/);
	assert.match(settingsSource, /normalizePreviewMaxWidth\(savedPreviewMaxWidth\)/);
	assert.match(settingsSource, /localStorage\.setItem\('preview\.maxWidth', String\(this\.previewMaxWidth\)\)/);
	assert.match(settingsSource, /resetPreviewMaxWidth\(\)[\s\S]*this\.previewMaxWidth = DEFAULT_PREVIEW_MAX_WIDTH/);
});

test('preview layout derives width and ToC geometry from the same preference', () => {
	assert.match(viewerSource, /getPreviewContentWidth\(settings\.previewMaxWidth, isFullWidth\)/);
	assert.match(viewerSource, /viewerWidth - previewContentWidth/);
	assert.match(viewerSource, /--preview-max-width:/);
	assert.match(viewerSource, /max-width: var\(--preview-max-width, 880px\)/);
});

test('Settings exposes a bounded preview-width input and reset action', () => {
	assert.match(settingsComponentSource, /id="preview-max-width"/);
	assert.match(settingsComponentSource, /min=\{MIN_PREVIEW_MAX_WIDTH\}/);
	assert.match(settingsComponentSource, /max=\{MAX_PREVIEW_MAX_WIDTH\}/);
	assert.match(settingsComponentSource, /bind:value=\{settings\.previewMaxWidth\}/);
	assert.match(settingsComponentSource, /settings\.resetPreviewMaxWidth\(\)/);
});
