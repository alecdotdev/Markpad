import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const markdownViewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const findBar = readFileSync('src/lib/components/FindBar.svelte', 'utf8');
const editor = readFileSync('src/lib/components/Editor.svelte', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

test('preview find opens before seeding a selected query', () => {
	assert.match(markdownViewer, /async function triggerFindAction\(\)/);
	assert.match(markdownViewer, /if \(previewSelection\) findBar\?\.setQuery\(previewSelection\.text, previewSelection\.range\);[\s\S]*findOpen = true;[\s\S]*await tick\(\)/);
});

test('preview find only seeds selections contained in one text node', () => {
	assert.match(markdownViewer, /range\.startContainer !== range\.endContainer/);
	assert.match(markdownViewer, /range\.startContainer\.nodeType !== Node\.TEXT_NODE/);
});

test('editor relies on Monaco native selection seeding', () => {
	assert.doesNotMatch(editor, /seedSearchStringFromSelection/);
});

test('workflow tests include selected-text search coverage', () => {
	assert.match(packageJson.scripts['test:workflows'], /scripts\/findSelectionWiring\.test\.ts/);
});

test('preview find active match uses range overlap instead of same-node identity', () => {
	assert.match(findBar, /compareBoundaryPoints\(Range\.START_TO_END, matchRange\) > 0/);
	assert.match(findBar, /compareBoundaryPoints\(Range\.END_TO_START, matchRange\) < 0/);
	assert.doesNotMatch(findBar, /pendingActiveRange\.startContainer !== textNode/);
	assert.doesNotMatch(findBar, /pendingActiveRange\.endContainer !== textNode/);
});

test('selection-seeded preview find preserves scroll even when range matching falls back', () => {
	assert.match(findBar, /pendingActiveTop = activeRange \? getRangeTop\(activeRange\) : null/);
	assert.match(findBar, /requestedActiveIndex \?\? closestActiveIndex \?\? preferredActiveIndex \?\? 0/);
	assert.match(findBar, /setActive\(nextActiveIndex, !shouldPreserveScroll && !options\.preserveScroll\)/);
});

test('selection match index survives a preview rerender before highlights apply', () => {
	assert.match(findBar, /query = value;[\s\S]*pendingActiveIndex = activeRange \? getRangeMatchIndex\(activeRange\) : null/);
	assert.match(findBar, /let requestedActiveIndex = pendingActiveIndex/);
	assert.match(findBar, /preferredActiveIndex: appliedQuery === query \? activeIndex : null/);
});

test('preview find reapply preserves active index without scrolling', () => {
	assert.match(findBar, /applyHighlights\(\{ preserveScroll: true, preferredActiveIndex: activeIndex \}\)/);
	assert.match(markdownViewer, /if \(findOpen\) \{[\s\S]*await tick\(\);[\s\S]*findBar\?\.reapply\(\);[\s\S]*\}/);
});

test('opening preview find does not trigger a duplicate render reapply', () => {
	assert.match(markdownViewer, /const _ = sanitizedHtml;[\s\S]*untrack\(\(\) => \{[\s\S]*if \(!findOpen \|\| !findBar\) return;[\s\S]*tick\(\)\.then\(\(\) => findBar\?\.reapply\(\)\);[\s\S]*\}\)/);
});
