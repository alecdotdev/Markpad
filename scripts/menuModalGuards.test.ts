import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');
const titleBar = readFileSync(new URL('../src/lib/components/TitleBar.svelte', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/lib/components/Modal.svelte', import.meta.url), 'utf8');

test('document context menus do not open while a modal is active', () => {
	assert.match(
		viewer,
		/function handleContextMenu\(e: MouseEvent\) \{\n\t\tif \(modalState\.show\) return;/,
	);
});

test('titlebar menus close before a document context menu opens', () => {
	assert.match(titleBar, /window\.addEventListener\('contextmenu', handleGlobalDismiss\)/);
	assert.match(titleBar, /window\.addEventListener\('blur', handleGlobalDismiss\)/);
});

test('modal backdrop consumes context-menu events', () => {
	assert.match(modal, /oncontextmenu=\{\(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\}/);
});
