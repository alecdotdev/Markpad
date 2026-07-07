import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const markdownViewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const settingsComponent = readFileSync('src/lib/components/Settings.svelte', 'utf8');
const settingsStore = readFileSync('src/lib/stores/settings.svelte.ts', 'utf8');
const titleBar = readFileSync('src/lib/components/TitleBar.svelte', 'utf8');

test('editor toolbar receives order and hidden configuration from settings', () => {
	assert.match(markdownViewer, /toolbarOrder=\{settings\.editorToolbarOrder\}/);
	assert.match(markdownViewer, /toolbarHidden=\{settings\.editorToolbarHidden\}/);
});

test('settings expose draggable toolbar customization controls', () => {
	assert.match(settingsComponent, /settings\.reorderEditorToolbarTool/);
	assert.match(settingsComponent, /draggable="true"/);
	assert.match(settingsComponent, /settings\.setEditorToolbarToolVisible/);
	assert.match(settingsComponent, /settings\.resetEditorToolbar/);
});

test('settings separate editor toolbar and application titlebar toolbar customization', () => {
	assert.match(settingsComponent, /activeCategory === 'toolbars'/);
	assert.match(settingsComponent, /settings\.reorderTitlebarToolbarAction/);
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

test('settings modal is resizable with size constraints', () => {
	assert.match(settingsComponent, /\.settings-modal[\s\S]*resize:\s*both/);
	assert.match(settingsComponent, /\.settings-modal[\s\S]*min-width:/);
	assert.match(settingsComponent, /\.settings-modal[\s\S]*max-height:/);
});

test('top toolbar overflow no longer includes Open file location action', () => {
	assert.doesNotMatch(titleBar, /list\.push\('open_loc'\)/);
});
