import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewer = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');

test('batch tab-close commands use the existing dirty-tab confirmation flow', () => {
	assert.match(viewer, /async function closeTabsWithConfirmation\(tabIds: string\[\]\)/);
	assert.match(
		viewer,
		/for \(const tabId of tabIds\) \{\s*if \(!\(await canCloseTab\(tabId\)\)\) return;\s*tabManager\.closeTab\(tabId\);\s*\}/,
	);
	assert.match(viewer, /menu-tab-close-others[\s\S]*await closeTabsWithConfirmation\(tabsToClose\)/);
	assert.match(viewer, /menu-tab-close-right[\s\S]*await closeTabsWithConfirmation\(tabsToClose\)/);
});
