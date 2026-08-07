import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './sourceTree.js';

const viewer = readSource(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url));
const titleBar = readSource(new URL('../src/lib/components/TitleBar.svelte', import.meta.url));
const modal = readSource(new URL('../src/lib/components/Modal.svelte', import.meta.url));

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

test('modal backdrop consumes context-menu events outside text fields', () => {
	assert.match(
		modal,
		/if \(\(e\.target as HTMLElement\)\.closest\('input, textarea'\)\) return;\n\t\t\te\.preventDefault\(\);\n\t\t\te\.stopPropagation\(\);/,
	);
});

test('text fields keep the webview edit menu so paste stays reachable', () => {
	assert.match(
		viewer,
		/if \(\(e\.target as HTMLElement\)\.closest\('input, textarea, \[contenteditable="true"\]'\)\) return;\n\t\te\.preventDefault\(\);/,
	);
});
