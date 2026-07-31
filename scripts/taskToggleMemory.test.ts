import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const session = readFileSync(new URL('../src/lib/sessions/documentSession.svelte.ts', import.meta.url), 'utf8');
const markdownProcessing: string = readFileSync(new URL('../src/lib/utils/markdown.ts', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');

test('preview task toggles transform the active in-memory buffer before saving', () => {
	const taskToggle = session.match(/async function toggleTaskCheckbox[\s\S]*?\n\t}\n\n\treturn/);
	assert.ok(taskToggle);
	assert.doesNotMatch(taskToggle[0], /read_file_content/);
	assert.match(taskToggle[0], /const raw = tab\.rawContent;/);
	assert.match(taskToggle[0], /getMarkdownBodyWithoutFrontMatter\(raw\)/);
	assert.match(taskToggle[0], /body\.slice\(0, offset\)\.split\('\\n'\)\.length/);
	assert.match(taskToggle[0], /(?:\[-\+\*\]|\\d\+\[\.\)\])/);
	assert.match(taskToggle[0], /tabManager\.updateTabRawContent\(tab\.id, updated\);/);
	assert.match(taskToggle[0], /await saveContent\(tab\.id\)/);
});

test('preview task toggles use the renderer source line instead of checkbox order', () => {
	const viewerToggle = viewer.match(/async function toggleTaskCheckbox[\s\S]*?\n\t}\n\n/);
	assert.ok(viewerToggle);
	assert.match(viewerToggle[0], /closest\('li'\)\?\.getAttribute\('data-sourcepos'\)/);
	assert.match(viewerToggle[0], /documentSession\.toggleTaskCheckbox\(sourceLine, nowChecked\)/);
	assert.doesNotMatch(viewerToggle[0], /allBoxes/);
});

test('preview task processing trusts the Markdown renderer task marker', () => {
	const taskProcessing = markdownProcessing.match(/function processTaskItems[\s\S]*?\n}\n\nexport function processMarkdownHtml/);
	assert.ok(taskProcessing);
	assert.match(taskProcessing[0], /input\.hasAttribute\("data-task-checkbox"\)/);
	assert.match(taskProcessing[0], /input\.setAttribute\("disabled", ""\)/);
	assert.match(markdownProcessing, /input\.removeAttribute\("disabled"\)/);
});
