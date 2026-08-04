import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { offsetOf, sliceBetween } from './sourceTree.js';

const markdown = readFileSync('src/lib/utils/markdown.ts', 'utf8');
const markdownViewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
const tauriConfig = readFileSync('src-tauri/tauri.conf.json', 'utf8');

test('YouTube links render as browser-opening thumbnail anchors', () => {
	assert.match(markdown, /function replaceWithYoutubeLink\(element: Element, videoId: string, href: string\)/);
	assert.match(markdown, /link\.className = ['"]youtube-link['"]/);
	assert.match(markdown, /link\.href = href/);
	assert.match(markdown, /https:\/\/i\.ytimg\.com\/vi\/\$\{videoId\}\/hqdefault\.jpg/);
	assert.match(markdown, /replaceWithYoutubeLink\(a, videoId, href\)/);
	assert.doesNotMatch(markdown, /createElement\(["']iframe["']\)/);
});

test('YouTube detection includes recognized embed URLs', () => {
	assert.match(markdown, /url\.includes\(["']youtube\.com\/embed\/["']\)/);
});

test('the app no longer permits YouTube frames', () => {
	assert.doesNotMatch(tauriConfig, /frame-src/);
});

test('linked YouTube thumbnails are not intercepted by image zoom', () => {
	const linkHandler = sliceBetween(
		markdownViewer,
		'async function handleLinkClick(e: MouseEvent)',
		'\n\tasync function toggleTaskCheckbox',
	);
	const anchorGuard = offsetOf(linkHandler, "const a = target.closest('a');");
	const imageZoom = offsetOf(linkHandler, "const img = target.closest('img');");

	assert.ok(anchorGuard < imageZoom, 'the anchor branch claims the click before image zoom sees it');
	assert.match(
		linkHandler,
		/if \(a\) \{[\s\S]*?if \(relativeMarkdownTarget\) \{[\s\S]*?return;[\s\S]*?\}\r?\n\s*return;\r?\n\s*\}\r?\n\r?\n\s*\/\/ media zoom handling/,
	);
});
