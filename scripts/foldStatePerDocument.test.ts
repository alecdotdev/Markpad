/**
 * Heading folds belong to the document, not to the window.
 *
 * The fold key `processMarkdownHtml` writes and reads is the heading's id —
 * comrak's slug — falling back to its text. That identifies a heading WITHIN a
 * document and nowhere else: every file with an `## Introduction` gets the key
 * `introduction`. While the viewer held one window-wide Set, folding that
 * section in one document folded it in every open document that had the same
 * heading, and the key outlived the document it was folded in, so the next file
 * to contain that heading opened with the section already shut and nothing on
 * screen to explain it.
 *
 * Per tab is not the same as per document. A tab can be repointed at another
 * file without a tab switch — following a link, and back/forward — and the set
 * used to travel with it, so the same collision reappeared one route over. The
 * second half of this file drives those three routes, and the routes that
 * change only the path and must leave the folds alone.
 *
 * These tests run the REAL `toggleFold` and `handleLinkClick` out of
 * MarkdownViewer.svelte, the REAL `visibleItems` out of Toc.svelte and the REAL
 * `processMarkdownHtml`, against the REAL TabManager. Nothing here asserts on
 * the text of an implementation file: what is checked is what a second document
 * renders as.
 *
 * The rune declarations are plucked too, not restated, because the whole fix
 * lives in one of them — whether `collapsedHeaders` is component state or a
 * read of the active tab. Restating it here would be restating the answer.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

import { installShimDom, parseHtml, type ShimElement } from './renderProtocolDom.ts';
import { offsetOf, readSource } from './sourceTree.js';

// ---------------------------------------------------------------- environment

const g = globalThis as any;
const runeEffect = (fn: () => void) => {
	void fn;
};
runeEffect.root = (fn: () => unknown) => fn();
g.$state = (value: unknown) => value;
g.$state.raw = (value: unknown) => value;
g.$state.snapshot = (value: unknown) => value;
g.$derived = (value: unknown) => value;
g.$derived.by = (fn: () => unknown) => fn();
g.$effect = runeEffect;
g.window = g.window ?? {};
g.window.__TAURI_INTERNALS__ = g.window.__TAURI_INTERNALS__ ?? {
	metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
	invoke: (cmd: string) => Promise.resolve(cmd === 'get_os_type' ? 'macos' : null),
};

const localStore = new Map<string, string>();
g.localStorage = g.localStorage ?? {
	getItem: (key: string) => (localStore.has(key) ? localStore.get(key)! : null),
	setItem: (key: string, value: string) => void localStore.set(key, String(value)),
	removeItem: (key: string) => void localStore.delete(key),
	clear: () => localStore.clear(),
};

installShimDom();

const { tabManager } = await import('../src/lib/stores/tabs.svelte.js');
const { processMarkdownHtml } = await import('../src/lib/utils/markdown.ts');

const viewer = readSource(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url));
const toc = readSource(new URL('../src/lib/components/Toc.svelte', import.meta.url));
const session = readSource(new URL('../src/lib/sessions/documentSession.svelte.ts', import.meta.url));

// ------------------------------------------------------------ source plucking

/** Index of the `}` that closes the block opening at `open`, comment/string aware. */
function matchBrace(source: string, open: number): number {
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		const c = source[i];
		const next = source[i + 1];
		if (c === '/' && next === '/') {
			i = source.indexOf('\n', i);
			continue;
		}
		if (c === '/' && next === '*') {
			i = source.indexOf('*/', i) + 1;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') {
			const quote = c;
			for (i++; i < source.length; i++) {
				if (source[i] === '\\') i++;
				else if (source[i] === quote) break;
			}
			continue;
		}
		if (c === '{') depth++;
		else if (c === '}' && --depth === 0) return i;
	}
	assert.fail(`unbalanced braces from offset ${open}`);
}

/** Slice one `function <name>(…) { … }` (async or not) out of a component. */
function pluckFunction(source: string, name: string, required = true): string {
	for (const marker of [`async function ${name}(`, `function ${name}(`]) {
		const start = source.indexOf(marker);
		if (start === -1) continue;
		const open = offsetOf(source, '{', offsetOf(source, ')', start));
		return source.slice(start, matchBrace(source, open) + 1);
	}
	assert.ok(!required, `expected the component to define ${name}`);
	return '';
}

/**
 * A top-level `let`/`const` declaration, with the rune peeled off.
 *
 * `$derived` is re-evaluated on every read, so it becomes an assignment in
 * `refresh` rather than an initializer — that is the whole difference between
 * a value that follows the active tab and one that does not, and the harness
 * must not paper over it. `$state` and a plain `const` initialize once.
 */
type Declaration = { declare: string; refresh: string };

function pluckDeclaration(source: string, name: string, required = true): Declaration | null {
	const match = new RegExp(`\\n\\t(let|const) ${name} = ([^\\n]*);\\n`).exec(source);
	if (!match) {
		assert.ok(!required, `expected the component to declare ${name} on one line`);
		return null;
	}
	const [, keyword, initializer] = match;
	const derived = /^\$derived(?:\.by)?\((.*)\)$/.exec(initializer);
	if (derived) return { declare: `let ${name};`, refresh: `${name} = ${derived[1]};` };
	const state = /^\$state\((.*)\)$/.exec(initializer);
	if (state) return { declare: `let ${name} = ${state[1]};`, refresh: '' };
	return { declare: `${keyword} ${name} = ${initializer};`, refresh: '' };
}

/** Position of a declaration in the component, so the harness keeps source order. */
function declarationOffset(source: string, name: string): number {
	const at = source.search(new RegExp(`\\n\\t(?:let|const) ${name} = `));
	return at === -1 ? Number.MAX_SAFE_INTEGER : at;
}

// -------------------------------------------------------------- the fixtures
//
// comrak's shape for two DIFFERENT documents that share a heading — the id is
// the slug, so both call it `introduction`, which is the collision the fix is
// about. Bodies differ so a mix-up is visible in the output rather than only in
// a flag.

const docHtml = (body: string) =>
	'<h2 data-sourcepos="1:1-1:15"><a href="#introduction" aria-hidden="true" class="anchor" id="introduction"></a>Introduction</h2>\n' +
	`<p data-sourcepos="3:1-3:11">${body}</p>\n`;

const DOC_A = docHtml('Alpha body.');
const DOC_B = docHtml('Beta body.');

const FOLD_KEY = 'introduction';

function render(html: string, path: string, folds: Set<string>): ShimElement {
	return parseHtml(processMarkdownHtml(html, path, folds)).body;
}

function isSectionCollapsed(body: ShimElement): boolean {
	return body.querySelector('.foldable-header.is-collapsed') !== null;
}

// ---------------------------------------------------------------- the harness

type Viewer = {
	/** The table of contents' fold button, and the keyboard route. */
	toggleFold: (key: string) => void;
	/** The preview chevron — also what FindBar clicks to reveal a match. */
	clickChevron: (icon: ShimElement) => Promise<void>;
	/** The set the viewer would hand `processMarkdownHtml` right now. */
	foldsOnScreen: () => Set<string>;
	/** Point the viewer at a rendered document, as `bind:this={markdownBody}` does. */
	showDocument: (body: ShimElement) => void;
};

function buildViewer(): Viewer {
	const names = ['NO_COLLAPSED_HEADERS', 'activeTab', 'collapsedHeaders'];
	const declarations = names
		.map((name) => ({ name, offset: declarationOffset(viewer, name) }))
		.sort((a, b) => a.offset - b.offset)
		.map(({ name }) => pluckDeclaration(viewer, name, name === 'collapsedHeaders'))
		.filter((declaration): declaration is Declaration => declaration !== null);

	const source = [
		pluckFunction(viewer, 'setCollapsedHeaders', false),
		pluckFunction(viewer, 'toggleFold'),
		pluckFunction(viewer, 'handleLinkClick'),
	]
		.filter(Boolean)
		.join('\n\n');

	const js = ts.transpileModule(
		[
			declarations.map((declaration) => declaration.declare).join('\n'),
			`const refresh = () => {\n${declarations.map((declaration) => declaration.refresh).join('\n')}\n};`,
			source,
		].join('\n\n'),
		{ compilerOptions: { target: ts.ScriptTarget.ES2022 } },
	).outputText;

	// `markdownBody` is the component's `bind:this` on the preview article, and
	// `document` is how `handleLinkClick` reaches the fold wrapper. Both are
	// injected so the plucked source runs unmodified.
	let preview: ShimElement | null = null;
	const factory = new Function(
		'deps',
		`"use strict";
		const { tabManager, CSS, document } = deps;
		let markdownBody = null;
		${js}
		return {
			setBody: (body) => { markdownBody = body; },
			toggleFold: (key) => { refresh(); return toggleFold(key); },
			handleLinkClick: (event) => { refresh(); return handleLinkClick(event); },
			folds: () => { refresh(); return collapsedHeaders; },
		};`,
	);

	const bound = factory({
		tabManager,
		CSS: { escape: (value: string) => value },
		document: {
			getElementById: (id: string) => preview?.querySelector(`[id="${id}"]`) ?? null,
		},
	});

	return {
		toggleFold: bound.toggleFold,
		clickChevron: (icon) =>
			bound.handleLinkClick({
				target: icon,
				detail: 1,
				preventDefault: () => {},
				stopPropagation: () => {},
			}),
		foldsOnScreen: bound.folds,
		showDocument: (body) => {
			preview = body;
			bound.setBody(body);
		},
	};
}

/** The real `visibleItems` out of Toc.svelte, over a caller-supplied fold set. */
function buildTocFilter() {
	const marker = 'let visibleItems = $derived.by(() => ';
	const start = offsetOf(toc, marker);
	const open = offsetOf(toc, '{', start + marker.length);
	const body = toc.slice(open, matchBrace(toc, open) + 1);
	const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	return new Function('items', 'collapsedHeaders', `"use strict";\n${js}`) as (
		items: unknown[],
		collapsedHeaders: Set<string>,
	) => Array<{ id: string }>;
}

const tocVisibleItems = buildTocFilter();

/**
 * The real `foldsForTab` out of documentSession — the set the LOAD path hands
 * the renderer, looked up at render time.
 *
 * The viewer's `collapsedHeaders` derived (above) is what the outline and the
 * live preview DOM read; this is what decides which sections the incoming
 * HTML is built with `is-collapsed` already on. They are different readers of
 * the same field and both are exercised below, because a fold leak shows up in
 * each of them separately.
 */
const foldsForTab = (() => {
	const js = ts.transpileModule(pluckFunction(session, 'foldsForTab'), {
		compilerOptions: { target: ts.ScriptTarget.ES2022 },
	}).outputText;
	return new Function('tabManager', `"use strict";\n${js}\nreturn foldsForTab;`)(tabManager) as (
		tabId: string,
	) => Set<string>;
})();

const TOC_ITEMS = [
	{ id: FOLD_KEY, text: 'Introduction', level: 2, isBlock: false, hasChildren: true },
	{ id: 'details', text: 'Details', level: 3, isBlock: false, hasChildren: false },
];

// ------------------------------------------------------------------ the tests

function reset() {
	tabManager.closeAll();
	tabManager.recentlyClosed.length = 0;
}

/** Open two documents that share a heading, fold it in the first, land on the second. */
function foldInAThenSwitchToB() {
	reset();
	const app = buildViewer();

	tabManager.addTab('/notes/a.md', DOC_A);
	const a = tabManager.activeTabId!;
	tabManager.addTab('/notes/b.md', DOC_B);
	const b = tabManager.activeTabId!;

	tabManager.setActive(a);
	app.showDocument(render(DOC_A, '/notes/a.md', app.foldsOnScreen()));
	app.toggleFold(FOLD_KEY);

	tabManager.setActive(b);
	return { app, a, b };
}

test('folding a heading in one document does not fold the same heading in another', () => {
	const { app } = foldInAThenSwitchToB();

	const onScreen = render(DOC_B, '/notes/b.md', app.foldsOnScreen());
	assert.equal(
		isSectionCollapsed(onScreen),
		false,
		'the second document must render with its own fold state, which is none',
	);
	assert.match(onScreen.textContent, /Beta body\./);
});

test('the fold is still there when the user comes back to the document they folded', () => {
	const { app, a } = foldInAThenSwitchToB();

	tabManager.setActive(a);
	assert.equal(isSectionCollapsed(render(DOC_A, '/notes/a.md', app.foldsOnScreen())), true);
});

test('a document opened after the fold does not open pre-folded', () => {
	// The worst version of the leak: the tab that was folded is gone, so there
	// is nothing on screen that could explain the missing section.
	const { app, a } = foldInAThenSwitchToB();
	tabManager.closeTab(a);

	tabManager.addTab('/notes/c.md', DOC_A);
	assert.equal(isSectionCollapsed(render(DOC_A, '/notes/c.md', app.foldsOnScreen())), false);
});

test('the table of contents hides the folded children only in the document they are folded in', () => {
	const { app, a, b } = foldInAThenSwitchToB();

	assert.deepEqual(
		tocVisibleItems(TOC_ITEMS, app.foldsOnScreen()).map((item) => item.id),
		[FOLD_KEY, 'details'],
		"the second document's table of contents must show its own children",
	);

	tabManager.setActive(a);
	assert.deepEqual(
		tocVisibleItems(TOC_ITEMS, app.foldsOnScreen()).map((item) => item.id),
		[FOLD_KEY],
		'the folded document still hides them',
	);

	tabManager.setActive(b);
	assert.equal(tocVisibleItems(TOC_ITEMS, app.foldsOnScreen()).length, 2);
});

test('the preview chevron folds the document on screen and no other', () => {
	// The route FindBar drives to reveal a match: it dispatches a click on the
	// `.header-fold-icon` rather than stripping the class, so this is also what
	// re-opens a fold that is hiding a search hit.
	reset();
	const app = buildViewer();

	tabManager.addTab('/notes/a.md', DOC_A);
	const a = tabManager.activeTabId!;
	tabManager.addTab('/notes/b.md', DOC_B);
	const b = tabManager.activeTabId!;

	tabManager.setActive(a);
	const body = render(DOC_A, '/notes/a.md', app.foldsOnScreen());
	app.showDocument(body);

	const chevron = body.querySelector('.foldable-header .header-fold-icon')!;
	return app.clickChevron(chevron).then(() => {
		assert.equal(isSectionCollapsed(body), true, 'the click collapses the section it was in');
		assert.equal(app.foldsOnScreen().has(FOLD_KEY), true);

		tabManager.setActive(b);
		assert.equal(app.foldsOnScreen().has(FOLD_KEY), false);
		assert.equal(isSectionCollapsed(render(DOC_B, '/notes/b.md', app.foldsOnScreen())), false);

		// And back: the same chevron re-opens it, which is what reveals a find
		// match, rather than leaving a second fold state behind.
		tabManager.setActive(a);
		return app.clickChevron(chevron).then(() => {
			assert.equal(isSectionCollapsed(body), false);
			assert.equal(app.foldsOnScreen().has(FOLD_KEY), false);
		});
	});
});

test('an untitled buffer gets fold state of its own', () => {
	// Untitled tabs have no path, so nothing keyed by file could hold their
	// folds. They are also the tabs most likely to share a heading with each
	// other — every new note starts the same way.
	reset();
	const app = buildViewer();

	tabManager.addNewTab();
	const first = tabManager.activeTabId!;
	tabManager.addNewTab();
	const second = tabManager.activeTabId!;

	tabManager.setActive(first);
	app.showDocument(render(DOC_A, '', app.foldsOnScreen()));
	app.toggleFold(FOLD_KEY);

	tabManager.setActive(second);
	assert.equal(isSectionCollapsed(render(DOC_B, '', app.foldsOnScreen())), false);

	tabManager.setActive(first);
	assert.equal(isSectionCollapsed(render(DOC_A, '', app.foldsOnScreen())), true);
});

test('closing a tab takes its fold state with it', () => {
	reset();
	const app = buildViewer();

	tabManager.addTab('/notes/a.md', DOC_A);
	const a = tabManager.activeTabId!;
	app.showDocument(render(DOC_A, '/notes/a.md', app.foldsOnScreen()));
	app.toggleFold(FOLD_KEY);
	assert.equal(app.foldsOnScreen().has(FOLD_KEY), true);

	tabManager.closeTab(a);
	tabManager.addTab('/notes/a.md', DOC_A);
	assert.equal(app.foldsOnScreen().has(FOLD_KEY), false, 'reopening the file starts fresh');
});

// ------------------------------------------- the routes that swap the document
//
// A tab does not only change document when the user switches to another tab.
// Three routes keep the tab and point it at a DIFFERENT file: `navigate`
// (following a Markdown link), `goBack` and `goForward`. `loadMarkdown` then
// renders the incoming file with `foldsForTab(activeId)` on the very next line
// (`documentSession.svelte.ts`), so the fold keys of the document the reader
// just LEFT decide which sections of the new one arrive shut.
//
// Nothing is deferred here: the HTML that first appears already carries
// `is-collapsed`, and the outline hides the same section's children on the same
// render. #425 gave the set a per-tab home, which fixed the tab-switch route;
// this is the same key collision reached through the navigation route. #447
// clears the reading position at these three sites for the same reason and
// scoped folds out of it — a position moves the viewport, a fold hides text.

/** Fold a heading in a.md, then follow a link to b.md, which shares the heading. */
function foldInAThenFollowLinkTo(path: string) {
	reset();
	const app = buildViewer();

	tabManager.addTab('/notes/a.md', DOC_A);
	const id = tabManager.activeTabId!;
	app.showDocument(render(DOC_A, '/notes/a.md', app.foldsOnScreen()));
	app.toggleFold(FOLD_KEY);
	assert.equal(app.foldsOnScreen().has(FOLD_KEY), true, 'precondition: a.md has the section folded');

	tabManager.navigate(id, path);
	return { app, id };
}

test('following a link renders the new document with its own fold state', () => {
	const { app, id } = foldInAThenFollowLinkTo('/notes/b.md');

	const onScreen = render(DOC_B, '/notes/b.md', foldsForTab(id));
	assert.equal(
		isSectionCollapsed(onScreen),
		false,
		'the document the link led to must render with its own fold state, which is none',
	);
	assert.match(onScreen.textContent, /Beta body\./);
	assert.equal(app.foldsOnScreen().has(FOLD_KEY), false);
});

test("the table of contents shows the linked document's children", () => {
	// The outline reads the same field through the viewer's derived, so it hides
	// the section's children in a document the user never folded anything in.
	const { app } = foldInAThenFollowLinkTo('/notes/b.md');

	assert.deepEqual(
		tocVisibleItems(TOC_ITEMS, app.foldsOnScreen()).map((item) => item.id),
		[FOLD_KEY, 'details'],
		'the outline must list the linked document’s own headings',
	);
});

/**
 * Land on `path` with the section folded in the document currently on screen —
 * and nothing folded before that, so the assertion cannot be satisfied by
 * `toggleFold` merely undoing a fold that was carried in.
 */
function foldHereThen(app: Viewer, id: string, html: string, path: string) {
	app.showDocument(render(html, path, foldsForTab(id)));
	app.toggleFold(FOLD_KEY);
	assert.equal(app.foldsOnScreen().has(FOLD_KEY), true, `precondition: ${path} has the section folded`);
}

test('going back renders the previous document with its own fold state', () => {
	reset();
	const app = buildViewer();
	tabManager.addTab('/notes/a.md', DOC_A);
	const id = tabManager.activeTabId!;
	tabManager.navigate(id, '/notes/b.md');
	foldHereThen(app, id, DOC_B, '/notes/b.md');

	assert.equal(tabManager.goBack(id), '/notes/a.md');
	assert.equal(isSectionCollapsed(render(DOC_A, '/notes/a.md', foldsForTab(id))), false);
});

test('going forward renders that document with its own fold state', () => {
	reset();
	const app = buildViewer();
	tabManager.addTab('/notes/a.md', DOC_A);
	const id = tabManager.activeTabId!;
	tabManager.navigate(id, '/notes/b.md');
	tabManager.goBack(id);
	foldHereThen(app, id, DOC_A, '/notes/a.md');

	assert.equal(tabManager.goForward(id), '/notes/b.md');
	assert.equal(isSectionCollapsed(render(DOC_B, '/notes/b.md', foldsForTab(id))), false);
});

test('the tab gets a new set rather than the old one emptied', () => {
	// `Tab.collapsedHeaders` is replaced, never mutated: the viewer's derived
	// holds the Set itself, and Svelte cannot see a `.clear()` of a Set it is
	// already holding — the outline would keep hiding the section.
	reset();
	tabManager.addTab('/notes/a.md', DOC_A);
	const id = tabManager.activeTabId!;
	const before = foldsForTab(id);

	tabManager.navigate(id, '/notes/b.md');

	assert.notEqual(foldsForTab(id), before, 'the navigation must install a different Set');
});

// ------------------------------------ the routes that change only the path
//
// The text on screen does not change in any of these, so the folds the reader
// put there still describe it. This is the half of the rule a blanket "clear on
// every path write" would break — the same guard #447 keeps for the position.

test('Save As keeps the folds, because the document on screen has not changed', () => {
	reset();
	const app = buildViewer();
	tabManager.addTab('/notes/a.md', DOC_A);
	const id = tabManager.activeTabId!;
	app.showDocument(render(DOC_A, '/notes/a.md', app.foldsOnScreen()));
	app.toggleFold(FOLD_KEY);

	tabManager.updateTabPath(id, '/notes/copy.md');

	assert.equal(tabManager.tabs.find((tab) => tab.id === id)!.path, '/notes/copy.md');
	assert.equal(isSectionCollapsed(render(DOC_A, '/notes/copy.md', foldsForTab(id))), true);
});

test('renaming the file on disk keeps the folds', () => {
	reset();
	const app = buildViewer();
	tabManager.addTab('/notes/a.md', DOC_A);
	const id = tabManager.activeTabId!;
	app.showDocument(render(DOC_A, '/notes/a.md', app.foldsOnScreen()));
	app.toggleFold(FOLD_KEY);

	tabManager.renameTab(id, '/notes/renamed.md');

	assert.equal(tabManager.tabs.find((tab) => tab.id === id)!.path, '/notes/renamed.md');
	assert.equal(isSectionCollapsed(render(DOC_A, '/notes/renamed.md', foldsForTab(id))), true);
});

test('a link that resolves to the file already open is not a navigation', () => {
	reset();
	const app = buildViewer();
	tabManager.addTab('/notes/a.md', DOC_A);
	const id = tabManager.activeTabId!;
	app.showDocument(render(DOC_A, '/notes/a.md', app.foldsOnScreen()));
	app.toggleFold(FOLD_KEY);

	tabManager.navigate(id, '/notes/a.md');

	assert.equal(isSectionCollapsed(render(DOC_A, '/notes/a.md', foldsForTab(id))), true);
});
