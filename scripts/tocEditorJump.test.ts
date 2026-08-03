import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const editor = readFileSync('src/lib/components/Editor.svelte', 'utf8');
const toc = readFileSync('src/lib/components/Toc.svelte', 'utf8');

test('ToC editor jumps use the clicked heading source line, not duplicate heading text', () => {
	assert.match(toc, /onjump\?: \(id: string, text: string, sourceLine: number \| null\) => void;/);
	assert.match(toc, /const \w+ = Number\(\w+\.dataset\.sourcepos\?\.match\(\/\^\(\\d\+\):\/\)\?\.\[1\]\)/);
	assert.match(viewer, /onjump=\{\(id: string, text: string, sourceLine: number \| null\) => \{[\s\S]*?editorPane\.revealHeader\(sourceLine, text\);/);
	assert.match(editor, /export function revealHeader\(sourceLine: number \| null, text: string\)/);
	assert.match(editor, /const (\w+) = sourceLine \?\? 0;[\s\S]*?revealLineInCenterIfOutsideViewport\(\1,/);
});
