import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	addFrontMatterListItem,
	addFrontMatterListItems,
	getMarkdownBodyWithoutFrontMatter,
	getFrontMatterListItems,
	parseFrontMatter,
	removeFrontMatterListItem,
	updateFrontMatterListItem,
	updateFrontMatterField,
} from '../src/lib/utils/frontMatter.js';

const planMarkdown = `---
type: plan
name: dflex-logger-onoff-dir-synlog
title: "Sterowanie loggerami dFLEX: on/off domyslnie OFF"
project: "dflex"
keywords: [logger, synlog, appconfig, onoff, codesite]
created: 2026-06-26T18:29:35+02:00
status: in-progress
---

## Summary

Body text.
`;

test('parseFrontMatter extracts top-level YAML metadata and body', () => {
	const parsed = parseFrontMatter(planMarkdown);

	assert.equal(parsed.exists, true);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.body, '## Summary\n\nBody text.\n');
	assert.deepEqual(
		parsed.fields.map((field) => [field.key, field.kind, field.displayValue]),
		[
			['type', 'string', 'plan'],
			['name', 'string', 'dflex-logger-onoff-dir-synlog'],
			['title', 'string', 'Sterowanie loggerami dFLEX: on/off domyslnie OFF'],
			['project', 'string', 'dflex'],
			['keywords', 'list', 'logger, synlog, appconfig, onoff, codesite'],
			['created', 'string', '2026-06-26T18:29:35+02:00'],
			['status', 'string', 'in-progress'],
		],
	);
});

test('parseFrontMatter ignores thematic breaks outside the first document line', () => {
	const markdown = `# Title

---

Body`;
	const parsed = parseFrontMatter(markdown);

	assert.equal(parsed.exists, false);
	assert.equal(parsed.body, markdown);
	assert.equal(getMarkdownBodyWithoutFrontMatter(markdown), markdown);
});

test('parseFrontMatter strips invalid front matter from rendered body but keeps the error', () => {
	const parsed = parseFrontMatter(`---
title: [broken
---

# Body
`);

	assert.equal(parsed.exists, true);
	assert.equal(parsed.valid, false);
	assert.match(parsed.error || '', /Flow sequence|unexpected|end/i);
	assert.equal(parsed.body, '# Body\n');
	assert.deepEqual(parsed.fields, []);
});

test('updateFrontMatterField updates one property without changing markdown body', () => {
	const updated = updateFrontMatterField(planMarkdown, 'status', 'done');
	const parsed = parseFrontMatter(updated);

	assert.equal(parsed.exists, true);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.fields.find((field) => field.key === 'status')?.displayValue, 'done');
	assert.equal(parsed.body, '## Summary\n\nBody text.\n');
});

test('updateFrontMatterField preserves CRLF documents', () => {
	const markdown = '---\r\nname: old\r\ntags:\r\n  - one\r\n---\r\n\r\nText\r\n';
	const updated = updateFrontMatterField(markdown, 'name', 'new');

	assert.match(updated, /^---\r\nname: new\r\ntags:/);
	assert.equal(parseFrontMatter(updated).body, 'Text\r\n');
});

test('getFrontMatterListItems returns string tag values for YAML lists', () => {
	const parsed = parseFrontMatter(planMarkdown);
	const keywords = parsed.fields.find((field) => field.key === 'keywords');

	assert.ok(keywords);
	assert.deepEqual(getFrontMatterListItems(keywords), ['logger', 'synlog', 'appconfig', 'onoff', 'codesite']);
});

test('front matter tag helpers add, edit, and remove tags predictably', () => {
	const original = ['logger', 'synlog'];

	assert.deepEqual(addFrontMatterListItem(original, ' appconfig '), ['logger', 'synlog', 'appconfig']);
	assert.deepEqual(addFrontMatterListItem(original, 'logger'), ['logger', 'synlog']);
	assert.deepEqual(addFrontMatterListItems(original, [' ', 'synlog', 'codesite, onoff']), ['logger', 'synlog', 'codesite', 'onoff']);
	assert.deepEqual(updateFrontMatterListItem(original, 1, ' syslog '), ['logger', 'syslog']);
	assert.deepEqual(updateFrontMatterListItem(original, 1, 'logger'), ['logger', 'synlog']);
	assert.deepEqual(updateFrontMatterListItem(original, 1, ' '), ['logger', 'synlog']);
	assert.deepEqual(removeFrontMatterListItem(original, 0), ['synlog']);
});

test('updateFrontMatterField writes edited keywords as a YAML list', () => {
	const updated = updateFrontMatterField(planMarkdown, 'keywords', ['logger', 'synlog']);
	const parsed = parseFrontMatter(updated);
	const keywords = parsed.fields.find((field) => field.key === 'keywords');

	assert.ok(keywords);
	assert.deepEqual(getFrontMatterListItems(keywords), ['logger', 'synlog']);
	assert.equal(parsed.body, '## Summary\n\nBody text.\n');
});
