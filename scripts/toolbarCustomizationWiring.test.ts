import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { getSupportedLanguages, translations, type LanguageCode } from '../src/lib/utils/i18n.js';

const markdownViewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const settingsComponent = readFileSync('src/lib/components/Settings.svelte', 'utf8');
const settingsStore = readFileSync('src/lib/stores/settings.svelte.ts', 'utf8');
const titleBar = readFileSync('src/lib/components/TitleBar.svelte', 'utf8');
const toastComponent = readFileSync('src/lib/components/Toast.svelte', 'utf8');

function getDirectTranslation(lang: LanguageCode, key: string): string | undefined {
	let current: unknown = translations[lang];
	for (const part of key.split('.')) {
		if (!current || typeof current !== 'object' || !(part in current)) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return typeof current === 'string' ? current : undefined;
}

test('editor toolbar receives order and hidden configuration from settings', () => {
	assert.match(markdownViewer, /toolbarOrder=\{settings\.editorToolbarOrder\}/);
	assert.match(markdownViewer, /toolbarHidden=\{settings\.editorToolbarHidden\}/);
});

test('settings expose pointer-driven toolbar customization controls', () => {
	assert.match(settingsComponent, /settings\.reorderEditorToolbarTool/);
	assert.match(settingsComponent, /handleEditorToolbarDragPointerDown/);
	assert.match(settingsComponent, /data-editor-toolbar-tool-id/);
	assert.match(settingsComponent, /settings\.setEditorToolbarToolVisible/);
	assert.match(settingsComponent, /settings\.resetEditorToolbar/);
	assert.doesNotMatch(settingsComponent, /draggable="true"/);
	assert.doesNotMatch(settingsComponent, /ondrag(start|over|end)|ondrop/);
});

test('settings separate editor toolbar and application titlebar toolbar customization', () => {
	assert.match(settingsComponent, /activeCategory === 'toolbars'/);
	assert.match(settingsComponent, /settings\.reorderTitlebarToolbarAction/);
	assert.match(settingsComponent, /handleTitlebarToolbarDragPointerDown/);
	assert.match(settingsComponent, /data-titlebar-toolbar-action-id/);
	assert.match(settingsComponent, /settings\.setTitlebarToolbarActionVisible/);
	assert.match(settingsComponent, /settings\.setTitlebarToolbarActionPlacement/);
	assert.match(settingsComponent, /settings\.resetTitlebarToolbar/);
	assert.match(settingsStore, /titlebar\.toolbarOrder/);
	assert.match(settingsStore, /titlebar\.toolbarHidden/);
	assert.match(settingsStore, /titlebar\.toolbarPlacement/);
});

test('titlebar applies user toolbar settings before rendering bar and more menu', () => {
	assert.match(titleBar, /getConfiguredTitlebarToolbarIds/);
	assert.match(titleBar, /settings\.titlebarToolbarOrder/);
	assert.match(titleBar, /configuredActionIds\.barIds/);
	assert.match(titleBar, /configuredActionIds\.menuIds/);
	assert.doesNotMatch(titleBar, /const inlineIds/);
});

test('settings modal uses a dedicated resize handle instead of native CSS resize', () => {
	assert.match(settingsComponent, /class="settings-resize-handle/);
	assert.match(settingsComponent, /handleSettingsResizePointerDown/);
	assert.doesNotMatch(settingsComponent, /resize:\s*both/);
	assert.match(settingsComponent, /\.settings-modal[\s\S]*min-width:/);
	assert.match(settingsComponent, /\.settings-modal[\s\S]*max-height:/);
});

test('settings modal can be dragged by the header and resized from every edge', () => {
	assert.match(settingsComponent, /handleSettingsModalDragPointerDown/);
	assert.match(settingsComponent, /class="settings-header"[\s\S]*onpointerdown=\{handleSettingsModalDragPointerDown\}/);
	assert.match(settingsComponent, /settingsResizeHandles/);
	for (const handleClass of ['resize-n', 'resize-ne', 'resize-e', 'resize-se', 'resize-s', 'resize-sw', 'resize-w', 'resize-nw']) {
		assert.match(settingsComponent, new RegExp(`className: '${handleClass}'`));
	}
});

test('settings modal does not light-dismiss when clicking the backdrop', () => {
	assert.match(settingsComponent, /aria-modal="true"/);
	assert.doesNotMatch(settingsComponent, /class="settings-backdrop"[^>]*onclick=\{handleBackdropClick\}/);
	assert.doesNotMatch(settingsComponent, /function handleBackdropClick[\s\S]*onclose\(\)/);
});

test('toolbar settings use collapsed accordions for application and editor toolbars', () => {
	const accordionBlocks = Array.from(settingsComponent.matchAll(/<details\s+class="toolbar-settings toolbar-settings-accordion"[\s\S]*?<\/details>/g));

	assert.equal(accordionBlocks.length, 2);
	assert.match(accordionBlocks[0][0], /settings\.applicationToolbar/);
	assert.match(accordionBlocks[1][0], /settings\.editorToolbar/);
	assert.match(accordionBlocks[0][0], /<summary class="toolbar-settings-summary">/);
	assert.match(accordionBlocks[1][0], /<summary class="toolbar-settings-summary">/);
	assert.match(accordionBlocks[0][0], /class="toolbar-settings-chevron"/);
	assert.match(accordionBlocks[1][0], /class="toolbar-settings-chevron"/);
	for (const block of accordionBlocks) {
		assert.doesNotMatch(block[0], /<details[^>]*\sopen(?:[\s=>]|$)/);
	}
	assert.match(settingsComponent, /\.toolbar-settings\[open\]\s+\.toolbar-settings-chevron/);
	assert.match(settingsComponent, /\.toolbar-settings-summary::-webkit-details-marker/);
});

test('interactive button labels are directly translated for every supported language', () => {
	const interactiveLabelKeys = [
		'common.close',
		'common.decrease',
		'common.increase',
		'toc.resizeTableOfContents',
		'settings.move',
		'settings.moveUp',
		'settings.moveDown',
		'settings.resetToolbar',
		'settings.toolbarOnBar',
		'settings.toolbarInMenu',
		'settings.resizeWindow',
	];

	const missing = getSupportedLanguages().flatMap(({ code }) =>
		interactiveLabelKeys
			.filter((key) => getDirectTranslation(code, key) === undefined)
			.map((key) => `${code}:${key}`)
	);

	assert.deepEqual(missing, []);
	assert.doesNotMatch(settingsComponent, /aria-label="(?:Close|Decrease|Increase)"/);
	assert.doesNotMatch(settingsComponent, />\s*(?:Up|Down)\s*</);
	assert.doesNotMatch(markdownViewer, /aria-label="Resize table of contents"/);
	assert.doesNotMatch(toastComponent, /aria-label="Close"/);
});

test('top toolbar overflow no longer includes Open file location action', () => {
	assert.doesNotMatch(titleBar, /list\.push\('open_loc'\)/);
});
