import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const markdown = readFileSync('src/lib/utils/markdown.ts', 'utf8');
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
