# YouTube External Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broken in-app YouTube embeds with thumbnail links that open the original video in the system browser.

**Architecture:** The Markdown HTML post-processor already recognizes standalone YouTube links and linked images. It will replace each recognized element with an anchor containing a thumbnail image and accessible label. The existing preview click handler already routes external HTTP(S) anchors to Tauri's opener plugin, so the card shares the normal external-link path.

**Tech Stack:** Svelte 5, TypeScript, DOM APIs, Node's built-in test runner, Tauri opener plugin.

## Global Constraints

- Support Windows, macOS, and Linux without platform-specific frontend code.
- Do not add a dependency or alter Markdown parsing outside recognized YouTube links.
- Preserve the source URL as the card anchor's `href`.
- Do not create an iframe or require a YouTube `frame-src` CSP allowance.

---

### Task 1: Specify and implement the rendered fallback card

**Files:**
- Modify: `scripts/youtubeExternalFallback.test.ts`
- Modify: `src/lib/utils/markdown.ts:42-65,518-535`
- Modify: `src-tauri/tauri.conf.json:15-22`

**Interfaces:**
- Consumes: `processMarkdownHtml(html, filePath, collapsedHeaders)`.
- Produces: HTML anchors with class `youtube-link`, original video `href`, and a thumbnail URL derived from the validated ID.

- [ ] **Step 1: Write the failing test**

```ts
test('standalone YouTube links become thumbnail anchors to the original URL', () => {
	const html = processMarkdownHtml(
		'<p><a href="https://youtu.be/dQw4w9WgXcQ">Watch</a></p>',
		'',
		new Set(),
	);

	assert.match(html, /<a[^>]+class="youtube-link"[^>]+href="https:\/\/youtu\.be\/dQw4w9WgXcQ"/);
	assert.match(html, /https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/);
	assert.doesNotMatch(html, /<iframe/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx scripts/youtubeExternalFallback.test.ts`

Expected: FAIL because the generated HTML contains an iframe and no `youtube-link` card.

- [ ] **Step 3: Write minimal implementation**

```ts
function replaceWithYoutubeLink(element: Element, videoId: string, href: string) {
	const link = element.ownerDocument.createElement('a');
	link.className = 'youtube-link';
	link.href = href;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.setAttribute('aria-label', 'Open YouTube video in browser');
	const image = element.ownerDocument.createElement('img');
	image.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
	image.alt = 'YouTube video thumbnail';
	link.appendChild(image);
	element.replaceWith(link);
}
```

Call this helper for validated standalone YouTube image and anchor URLs, pass through the source URL, remove the iframe CSS, and remove YouTube from `frame-src`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx scripts/youtubeExternalFallback.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-08-02-youtube-external-fallback.md scripts/youtubeExternalFallback.test.ts src/lib/utils/markdown.ts src-tauri/tauri.conf.json
git commit -m "fix: open YouTube embeds externally"
```
