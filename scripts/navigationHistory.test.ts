import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	canGoBackInHistory,
	canGoForwardInHistory,
	createFileHistory,
	goBackInHistory,
	goForwardInHistory,
	navigateFileHistory,
	replaceCurrentHistoryEntry,
} from '../src/lib/utils/tabHistory.js';
import {
	getMarkdownLinkTarget,
	isOpenInNewTabMarkdownTarget,
	resolveMarkdownTargetPath,
} from '../src/lib/utils/markdownLinks.js';

test('new file tabs start history with their path, not initial content', () => {
	assert.deepEqual(createFileHistory('/notes/a.md', 'body text'), {
		history: ['/notes/a.md'],
		historyIndex: 0,
	});
});

test('untitled tabs keep an empty initial history entry', () => {
	assert.deepEqual(createFileHistory('', ''), {
		history: [''],
		historyIndex: 0,
	});
});

test('navigating appends paths and truncates forward entries', () => {
	const afterBack = goBackInHistory({
		history: ['/notes/a.md', '/notes/b.md', '/notes/c.md'],
		historyIndex: 1,
	});

	assert.equal(afterBack.path, '/notes/a.md');
	assert.equal(afterBack.historyIndex, 0);

	const afterNavigate = navigateFileHistory({
		currentPath: afterBack.path!,
		targetPath: '/notes/d.md',
		history: afterBack.history,
		historyIndex: afterBack.historyIndex,
	});

	assert.deepEqual(afterNavigate.history, ['/notes/a.md', '/notes/d.md']);
	assert.equal(afterNavigate.historyIndex, 1);
	assert.equal(canGoBackInHistory(afterNavigate), true);
	assert.equal(canGoForwardInHistory(afterNavigate), false);
});

test('back and forward stay inside history bounds', () => {
	const initial = {
		history: ['/notes/a.md', '/notes/b.md'],
		historyIndex: 0,
	};

	assert.equal(canGoBackInHistory(initial), false);
	assert.equal(goBackInHistory(initial).path, null);

	const forward = goForwardInHistory(initial);
	assert.equal(forward.path, '/notes/b.md');
	assert.equal(forward.historyIndex, 1);
	assert.equal(canGoForwardInHistory(forward), false);
});

test('replacing current history entry keeps file history path-based', () => {
	assert.deepEqual(
		replaceCurrentHistoryEntry({
			currentPath: '',
			targetPath: '/notes/saved.md',
			history: [''],
			historyIndex: 0,
		}),
		{
			history: ['/notes/saved.md'],
			historyIndex: 0,
		}
	);
});

test('markdown link target detection accepts local markdown and rejects external links', () => {
	assert.deepEqual(getMarkdownLinkTarget('../docs/Guide%20One.md#intro'), {
		path: '../docs/Guide One.md',
		hash: 'intro',
	});
	assert.equal(getMarkdownLinkTarget('https://example.com/docs/readme.md'), null);
	assert.equal(getMarkdownLinkTarget('//example.com/readme.md'), null);
	assert.equal(getMarkdownLinkTarget('#local-anchor'), null);
	assert.equal(getMarkdownLinkTarget('../docs/image.png'), null);
});

test('open-in-new-tab target requires a resolvable local markdown link', () => {
	assert.equal(isOpenInNewTabMarkdownTarget('../docs/guide.md', '/vault/current.md'), true);
	assert.equal(isOpenInNewTabMarkdownTarget('../docs/guide.md', ''), false);
	assert.equal(isOpenInNewTabMarkdownTarget('/vault/guide.md', ''), true);
	assert.equal(isOpenInNewTabMarkdownTarget('https://example.com/guide.md', '/vault/current.md'), false);
});

test('relative markdown target resolves against the source file directory', () => {
	const target = getMarkdownLinkTarget('../docs/guide.md#usage');
	assert.ok(target);
	assert.equal(resolveMarkdownTargetPath('/vault/notes/current.md', target), '/vault/docs/guide.md');
});
