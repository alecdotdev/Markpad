import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const viewerSource = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');

test('front matter panel uses native details disclosure so collapsed summary remains expandable', () => {
	const panelStart = viewerSource.indexOf('frontmatter-panel');
	assert.notEqual(panelStart, -1);

	const panelSource = viewerSource.slice(panelStart - 160, panelStart + 900);

	assert.match(panelSource, /<details\b[^>]*class="frontmatter-panel"/);
	assert.match(panelSource, /<summary\b[^>]*class="frontmatter-summary"/);
	assert.doesNotMatch(panelSource, /<button\b[^>]*class="frontmatter-summary"/);
});

test('front matter panel is collapsed by default until the user opens it', () => {
	assert.match(viewerSource, /frontMatterCollapsedByKey\[frontMatterPanelKey\]\s*\?\?\s*true/);
	assert.match(viewerSource, /open=\{!isFrontMatterCollapsed\}/);
});

test('front matter list fields render as editable tags instead of one comma input', () => {
	const listBranchStart = viewerSource.indexOf("field.kind === 'list'");
	assert.notEqual(listBranchStart, -1);

	const listBranch = viewerSource.slice(listBranchStart, listBranchStart + 4000);

	assert.match(listBranch, /class="frontmatter-tags"/);
	assert.match(listBranch, /class="frontmatter-tag-remove"/);
	assert.match(listBranch, /class="frontmatter-tag-add-button"/);
	assert.match(listBranch, /startFrontMatterTagEdit/);
	assert.match(listBranch, /value=\{getFrontMatterTagDraft\(field\)\}/);
});
