import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const markdownViewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const titleBar = readFileSync('src/lib/components/TitleBar.svelte', 'utf8');
const editor = readFileSync('src/lib/components/Editor.svelte', 'utf8');
const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf8');

test('manual reload is wired through menu, titlebar, and F5 with dirty-state protection', () => {
	assert.match(markdownViewer, /async function reloadFromDisk\(\)/);
	assert.match(markdownViewer, /await canCloseTab\(activeId\)/);
	assert.match(markdownViewer, /loadMarkdown\(tab\.path,\s*\{[\s\S]*preserveEditState:\s*true/);
	assert.match(markdownViewer, /code === 'F5'[\s\S]*reloadFromDisk\(\)/);
	assert.match(markdownViewer, /listen\('menu-file-reload'[\s\S]*reloadFromDisk\(\)/);
	assert.match(titleBar, /onreloadFromDisk/);
	assert.match(titleBar, /id === 'reload'/);
	assert.match(tauriLib, /menu-file-reload/);
	assert.match(tauriLib, /\.accelerator\("F5"\)/);
});

test('preview-level open shortcut handles Ctrl/Cmd+O outside Monaco without double-handling macOS native menu', () => {
	assert.match(markdownViewer, /settings\.osType === 'macos'[\s\S]*key === 'o'[\s\S]*return/);
	assert.match(markdownViewer, /cmdOrCtrl[\s\S]*key === 'o'[\s\S]*selectFile\(\)/);
});

test('editor toolbar delegates to Monaco actions and exposes expected Markdown commands', () => {
	assert.match(markdownViewer, /import EditorToolbar from '\.\/components\/EditorToolbar\.svelte'/);
	assert.match(markdownViewer, /<EditorToolbar[\s\S]*onaction=\{\(actionId\) => editorPane\?\.runEditorAction\(actionId\)\}/);
	assert.match(editor, /export function runEditorAction\(actionId: string\)/);

	for (const actionId of [
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
	]) {
		assert.match(editor, new RegExp(`id: "${actionId}"`));
	}
});
