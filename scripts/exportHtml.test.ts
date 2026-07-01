import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFrontMatter } from '../src/lib/utils/frontMatter.js';
import {
	normalizeAssetPath,
	renderStaticFrontMatterPanel,
	resolveExportImagePath,
	rewriteMarkdownHrefForExport,
} from '../src/lib/utils/exportHtml.js';

test('normalizeAssetPath decodes Tauri asset URLs for Windows drive paths and UNC paths', () => {
	assert.equal(
		normalizeAssetPath('asset://localhost/C:/Users/Daniel/My%20Pictures/diagram.png'),
		'C:/Users/Daniel/My Pictures/diagram.png',
	);
	assert.equal(
		normalizeAssetPath('asset://localhost/%5C%5Cserver%5Cshare%5Cimage.png'),
		'\\\\server\\share\\image.png',
	);
});

test('resolveExportImagePath preserves remote/data images and resolves local paths cross-platform', () => {
	assert.equal(resolveExportImagePath('https://example.test/a.png', 'C:\\Docs\\note.md'), null);
	assert.equal(resolveExportImagePath('data:image/png;base64,abc', '/home/daniel/note.md'), null);
	assert.equal(resolveExportImagePath('img/a%20b.png', 'C:\\Docs\\note.md'), 'C:/Docs/img/a b.png');
	assert.equal(resolveExportImagePath('./img/a.png', '/home/daniel/docs/note.md'), '/home/daniel/docs/img/a.png');
	assert.equal(resolveExportImagePath('/home/daniel/assets/a.png', '/home/daniel/docs/note.md'), '/home/daniel/assets/a.png');
});

test('rewriteMarkdownHrefForExport rewrites local Markdown links and preserves query/hash', () => {
	assert.equal(rewriteMarkdownHrefForExport('notes/Plan%20A.md#todo'), 'notes/Plan%20A.html#todo');
	assert.equal(rewriteMarkdownHrefForExport('../x/readme.markdown?raw=1#top'), '../x/readme.html?raw=1#top');
	assert.equal(rewriteMarkdownHrefForExport('C:/Docs/spec.mdown#sec'), 'C:/Docs/spec.html#sec');
	assert.equal(rewriteMarkdownHrefForExport('https://example.test/a.md'), 'https://example.test/a.md');
	assert.equal(rewriteMarkdownHrefForExport('mailto:test@example.test'), 'mailto:test@example.test');
});

test('renderStaticFrontMatterPanel exports a collapsed, non-interactive properties block', () => {
	const parsed = parseFrontMatter(`---
type: plan
keywords: [logger, synlog]
draft: false
---

# Body
`);

	const html = renderStaticFrontMatterPanel(parsed);

	assert.match(html, /<details class="frontmatter-panel export-frontmatter-panel">/);
	assert.match(html, /<summary class="frontmatter-summary">/);
	assert.match(html, /<span class="frontmatter-title">Properties<\/span>/);
	assert.match(html, /<span class="frontmatter-tag">logger<\/span>/);
	assert.match(html, /<span class="frontmatter-tag">synlog<\/span>/);
	assert.doesNotMatch(html, /\sopen(?:\s|>)/);
	assert.doesNotMatch(html, /<(?:input|button|textarea|select)\b/i);
});
