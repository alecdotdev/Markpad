import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const markdownViewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const editor = readFileSync('src/lib/components/Editor.svelte', 'utf8');

test('preview scroll sync uses pixel segment positions instead of source lines', () => {
	assert.match(markdownViewer, /type ScrollSyncPosition = \{\s*section: 'frontmatter' \| 'body';\s*ratio: number;\s*\}/);
	assert.match(markdownViewer, /function getPreviewFrontMatterScrollEnd\(target: HTMLElement\)/);
	assert.match(markdownViewer, /function getPreviewScrollSyncPosition\(target: HTMLElement\)/);
	assert.match(markdownViewer, /function scrollPreviewToSyncPosition\(position: ScrollSyncPosition\)/);
	assert.match(markdownViewer, /function handleEditorScrollSync\(position: ScrollSyncPosition\)/);
	assert.match(markdownViewer, /const position = getPreviewScrollSyncPosition\(target\);[\s\S]*editorPane\.syncScrollToPosition\(position\)/);
	assert.doesNotMatch(markdownViewer, /editorPane\.syncScrollToLine\(anchor\.line, anchor\.ratio\)/);
});

test('editor emits and applies pixel segment scroll positions', () => {
	assert.match(editor, /type ScrollSyncPosition = \{\s*section: 'frontmatter' \| 'body';\s*ratio: number;\s*\}/);
	assert.match(editor, /onscrollsync\?: \(position: ScrollSyncPosition\) => void/);
	assert.match(editor, /function getEditorFrontMatterScrollEnd\(\)/);
	assert.match(editor, /function getEditorScrollSyncPosition\(\)/);
	assert.match(editor, /export function syncScrollToPosition\(position: ScrollSyncPosition\)/);
	assert.match(editor, /onscrollsync\?\.\(getEditorScrollSyncPosition\(\)\)/);
	assert.doesNotMatch(editor, /onscrollsync\?\.\(position\.lineNumber, ratio\)/);
	assert.doesNotMatch(editor, /export function syncScrollToLine/);
});

test('source-position anchors are retained only for saved tab anchor lines', () => {
	assert.match(markdownViewer, /type PreviewScrollAnchor/);
	assert.match(markdownViewer, /function getPreviewScrollAnchor\(target: HTMLElement\)/);
	assert.match(markdownViewer, /const anchor = getPreviewScrollAnchor\(target\);[\s\S]*tabManager\.updateTabAnchorLine\(tabManager\.activeTabId, anchor\.line\)/);
	assert.doesNotMatch(markdownViewer, /if \(!sourcepos\) break/);
});
