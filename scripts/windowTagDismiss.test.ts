import assert from 'node:assert/strict';
import test from 'node:test';

import { parse } from 'svelte/compiler';

import { callbackBodies, functionSource, readSource } from './sourceTree.js';

/*
 * The window-tag popover in TitleBar.svelte had no way out that did not write
 * something. `tagEditorOpen` went false in exactly two places — `applyTag`
 * (Save/Enter) and `clearTag` (Remove Tag, which only renders once a tag
 * exists) — so on a window with no tag yet, Save was the single exit. Escape
 * did nothing, a click elsewhere did nothing, and the chip re-opened rather
 * than toggled.
 *
 * The three other popovers in the same component — the Home menu, the theme
 * menu and the kebab menu — all take Escape on the container and all appear in
 * `handleGlobalDismiss`, which a `$effect` wires to window `click`,
 * `contextmenu` and `blur` while any of them is open. The tag editor was the
 * only one missing from both.
 *
 * These tests RUN the real handlers rather than looking for them. A `.svelte`
 * file cannot be imported by the Node test runner, so — following
 * homeTabRender.test.ts — the component's own function declarations, its two
 * markup handlers on `.tag-editor`, the `onclick` the chip is actually wired
 * to, and the body of the `$effect` that installs the window listeners are
 * lifted out of the parsed component and evaluated over one shared set of
 * component variables and the REAL `TabManager`. Nothing below asserts how any
 * of it is spelled: rewrite the dismissal any way that still closes the
 * popover without writing a tag and these stay green.
 *
 * What this does not establish: focus, CSS, or that Svelte flushes the effect
 * where `clickPath` assumes it does. It establishes what the handlers do when
 * they run.
 */

// ---------------------------------------------------------------- environment
// Svelte runes and the Tauri bridge, faked as homeSentinelSnapshot.ts does, so
// `tabs.svelte.ts` imports under plain node.

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

const localStore = new Map<string, string>();
g.localStorage = {
	getItem: (key: string) => (localStore.has(key) ? localStore.get(key)! : null),
	setItem: (key: string, value: string) => void localStore.set(key, String(value)),
	removeItem: (key: string) => void localStore.delete(key),
	clear: () => localStore.clear(),
};
g.window.__TAURI_INTERNALS__ = {
	metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
	invoke: (cmd: string) => Promise.resolve(cmd === 'get_os_type' ? 'macos' : null),
};

const { tabManager } = await import('../src/lib/stores/tabs.svelte.js');

// ------------------------------------------------- the component, as written

const TITLE_BAR = 'src/lib/components/TitleBar.svelte';
const source = readSource(TITLE_BAR);

type Node = Record<string, any>;

function collect(node: unknown, hit: (node: Node) => void): void {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const child of node) collect(child, hit);
		return;
	}
	hit(node as Node);
	for (const key of Object.keys(node as Node)) {
		if (key === 'parent' || key === 'metadata') continue;
		collect((node as Node)[key], hit);
	}
}

const fragment = parse(source, { modern: true, filename: TITLE_BAR }).fragment;

/** The one element carrying exactly `class="<name>"`. */
function element(className: string): Node {
	const found: Node[] = [];
	collect(fragment, (node) => {
		if (node.type !== 'RegularElement') return;
		const attribute = node.attributes?.find((a: Node) => a.type === 'Attribute' && a.name === 'class');
		const value = attribute?.value;
		if (!Array.isArray(value) || value.length !== 1 || value[0].type !== 'Text') return;
		if (value[0].data === className) found.push(node);
	});
	assert.equal(found.length, 1, `expected exactly one <… class="${className}"> in ${TITLE_BAR}, found ${found.length}`);
	return found[0];
}

/**
 * The source of a DOM handler on that element, e.g. `onkeydown`.
 *
 * An absent handler is a no-op rather than an assertion failure, deliberately.
 * Asserting here builds the whole harness on the presence of an attribute, so
 * deleting one turns every test in the file red with the same structural
 * message — including the fences, whose entire job is to stay green — and none
 * of them would then be evidence about behaviour. A handler that is not there
 * does nothing when the user's event arrives, which is exactly what a no-op
 * models, and each test fails on its own claim: "Escape left the popover open".
 */
function handlerSource(node: Node, name: string): string {
	const attribute = node.attributes?.find((a: Node) => a.type === 'Attribute' && a.name === name);
	if (attribute?.value?.type !== 'ExpressionTag') return '(() => {})';
	return source.slice(attribute.value.expression.start, attribute.value.expression.end);
}

/** The one element under `root` whose `onclick` source contains `marker`. */
function elementByHandler(root: Node, marker: string): Node {
	const found: Node[] = [];
	collect(root, (node) => {
		if (node.type !== 'RegularElement' || node === root) return;
		if (handlerSource(node, 'onclick').includes(marker)) found.push(node);
	});
	assert.equal(found.length, 1, `expected exactly one element under the subtree whose onclick contains ${JSON.stringify(marker)}, found ${found.length}`);
	return found[0];
}

/** The initialiser of a top-level `const`, evaluated. */
function constantValue(name: string): unknown {
	const found: Node[] = [];
	collect(parse(source, { modern: true, filename: TITLE_BAR }).instance, (node) => {
		if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.id.name === name && node.init) {
			found.push(node.init);
		}
	});
	assert.equal(found.length, 1, `expected exactly one \`${name}\` declaration in ${TITLE_BAR}`);
	return new Function(`return (${source.slice(found[0].start, found[0].end)});`)();
}

/** The `$effect` that installs the window-level dismissal listeners. */
const dismissEffectBody = (() => {
	const bodies = callbackBodies(source, '$effect').filter((body) => body.includes('handleGlobalDismiss'));
	assert.equal(bodies.length, 1, `expected exactly one $effect wiring handleGlobalDismiss, found ${bodies.length}`);
	return bodies[0];
})();

// ------------------------------------------------------------- the harness
//
// One `new Function` scope holding the component's real tag functions and the
// real markup handlers over one set of `let`s, so `handleGlobalDismiss` and the
// keydown handler close the same `tagEditorOpen` the chip opened.

type WindowStub = {
	listeners: Map<string, () => void>;
	addEventListener: (type: string, fn: () => void) => void;
	removeEventListener: (type: string, fn: () => void) => void;
};

type ClickHandler = (event: { stopPropagation: () => void }) => void;

type TitleBar = {
	state: () => { tagEditorOpen: boolean; tagDraftName: string; tagDraftColor: string; homeMenuOpen: boolean };
	setDraft: (name: string, color: string) => void;
	openHomeMenu: () => void;
	openTagEditor: () => void;
	applyTag: () => void;
	chipClick: ClickHandler;
	editorClick: ClickHandler;
	editorKeydown: (event: { key: string }) => void;
	homeMenuTagItemClick: ClickHandler;
	homeMenuClick: ClickHandler;
	dismissEffect: () => (() => void) | undefined;
};

function createTitleBar(windowStub: WindowStub): TitleBar {
	const factory = new Function(
		'tabManager',
		'tagColors',
		'invoke',
		'window',
		`
		let tagEditorOpen = false;
		let tagDraftName = '';
		let tagDraftColor = tagColors[1];
		let themeMenuOpen = false;
		let kebabMenuOpen = false;
		let homeMenuOpen = false;

		${functionSource(source, 'openTagEditor')}
		${functionSource(source, 'applyTag')}
		${functionSource(source, 'clearTag')}
		${functionSource(source, 'handleGlobalDismiss')}

		return {
			state: () => ({ tagEditorOpen, tagDraftName, tagDraftColor, homeMenuOpen }),
			setDraft: (name, color) => { tagDraftName = name; tagDraftColor = color; },
			openHomeMenu: () => { homeMenuOpen = true; },
			openTagEditor,
			applyTag,
			chipClick: ${handlerSource(element('window-tag-chip'), 'onclick')},
			editorClick: ${handlerSource(element('tag-editor'), 'onclick')},
			editorKeydown: ${handlerSource(element('tag-editor'), 'onkeydown')},
			homeMenuTagItemClick: ${handlerSource(elementByHandler(element('home-dropdown-menu'), 'openTagEditor()'), 'onclick')},
			homeMenuClick: ${handlerSource(element('home-dropdown-menu'), 'onclick')},
			dismissEffect: () => ${dismissEffectBody},
		};
		`,
	) as (tabManager: unknown, tagColors: unknown, invoke: unknown, window: unknown) => TitleBar;

	return factory(tabManager, constantValue('tagColors'), () => Promise.resolve(null), windowStub);
}

const COLORS = constantValue('tagColors') as string[];

function setup() {
	const listeners = new Map<string, () => void>();
	const windowStub: WindowStub = {
		listeners,
		addEventListener: (type, fn) => void listeners.set(type, fn),
		removeEventListener: (type, fn) => {
			if (listeners.get(type) === fn) listeners.delete(type);
		},
	};

	tabManager.setWindowTag(null);
	const bar = createTitleBar(windowStub);
	let cleanup: (() => void) | undefined;

	/** Re-run the effect the way Svelte does: previous teardown, then the body. */
	const flush = () => {
		cleanup?.();
		cleanup = bar.dismissEffect();
	};

	/**
	 * One click, dispatched along a bubble path: target handler first, then each
	 * ancestor's, then `window` — unless something on the way called
	 * `stopPropagation`.
	 *
	 * The path matters because the effect that installs `handleGlobalDismiss`
	 * runs before the click has finished bubbling, so the window listener sees
	 * the very click that opened the popover. That is why the chip stops
	 * propagation, and why a menu item that opens the tag editor is safe only if
	 * something above it does. Modelling the path is the only way a test can
	 * tell a working entry point from one that opens the popover and dismisses
	 * it again in the same click.
	 *
	 * The listener is re-read after `flush()` but falls back to the one already
	 * installed before the click, so both orderings — a listener present because
	 * another popover was open, and one installed by this very click — reach the
	 * same `handleGlobalDismiss`.
	 */
	const clickPath = (...handlers: ClickHandler[]) => {
		const installed = listeners.get('click');
		let stopped = false;
		for (const handler of handlers) {
			if (stopped) break;
			handler({ stopPropagation: () => void (stopped = true) });
		}
		flush();
		if (!stopped) (listeners.get('click') ?? installed)?.();
	};

	/** A click anywhere the component does not handle. */
	const clickOutside = () => {
		flush();
		listeners.get('click')?.();
	};

	return { bar, listeners, flush, clickPath, clickOutside };
}

// --------------------------------------------------------------- the regression

test('Escape closes the tag editor on a window that has no tag yet', () => {
	// The reported dead end: with no tag set, `Remove Tag` is not rendered and
	// Save is the only control that closes the popover.
	const { bar } = setup();
	bar.openTagEditor();
	bar.setDraft('Research', COLORS[2]);

	bar.editorKeydown({ key: 'Escape' });

	assert.equal(bar.state().tagEditorOpen, false, 'Escape left the popover open');
	assert.equal(tabManager.windowTag, null, 'Escape wrote a tag — dismissing must not commit the draft');
});

test('a click elsewhere in the window closes the tag editor', () => {
	const { bar, clickOutside } = setup();
	bar.openTagEditor();
	bar.setDraft('Research', COLORS[2]);

	clickOutside();

	assert.equal(bar.state().tagEditorOpen, false, 'a click outside left the popover open');
	assert.equal(tabManager.windowTag, null, 'a click outside wrote a tag');
});

test('the chip toggles the tag editor instead of only opening it', () => {
	const { bar, clickPath } = setup();
	tabManager.setWindowTag({ name: 'Docs', color: COLORS[1] });

	clickPath(bar.chipClick);
	assert.equal(bar.state().tagEditorOpen, true, 'the chip did not open the popover, or opened it into its own dismissal');

	clickPath(bar.chipClick);
	assert.equal(bar.state().tagEditorOpen, false, 'a second click on the chip left the popover open');
	assert.deepEqual(tabManager.windowTag, { name: 'Docs', color: COLORS[1], pinned: false }, 'toggling the chip changed the tag');
});

test('opening the tag editor from the Home menu survives the click that opened it', () => {
	/*
	 * The other entry point, and the one this fix could plausibly have broken.
	 * `Home > Set window tag` runs `homeMenuOpen = false; openTagEditor();` and
	 * calls no `stopPropagation` of its own, while `homeMenuOpen` being true
	 * means the window `click` listener is ALREADY installed when it runs. Now
	 * that `handleGlobalDismiss` closes the tag editor too, a click that reached
	 * the window would open the popover and shut it again in one gesture, and
	 * the user would see nothing happen.
	 *
	 * It does not reach the window: `.home-dropdown-menu` — the item's parent —
	 * carries `onclick={(e) => e.stopPropagation()}`, which is why none of the
	 * menu items need one each. That containment is load-bearing for this fix
	 * and was previously untested, so the whole path runs here: listener already
	 * installed, then the item's handler, then the container's.
	 */
	const { bar, listeners, flush, clickPath } = setup();
	bar.openHomeMenu();
	flush();
	assert.ok(listeners.get('click'), 'precondition: an open Home menu has already installed the window listener');

	clickPath(bar.homeMenuTagItemClick, bar.homeMenuClick);

	assert.equal(bar.state().homeMenuOpen, false, 'the Home menu stayed open');
	assert.equal(bar.state().tagEditorOpen, true, 'the menu item opened the tag editor into its own dismissal');
});

test('dismissing discards the draft: reopening shows the stored tag', () => {
	// Discard rather than keep, matching the Escape-cancels convention of every
	// popover editor a user meets elsewhere, and forced by the popover having an
	// explicit Save: a control that commits on demand cannot also commit on the
	// way out. The mechanism is `openTagEditor` re-seeding both draft fields.
	const { bar } = setup();
	tabManager.setWindowTag({ name: 'Docs', color: COLORS[1] });
	bar.openTagEditor();
	bar.setDraft('Docs, rewritten', COLORS[4]);

	bar.editorKeydown({ key: 'Escape' });
	assert.equal(bar.state().tagEditorOpen, false, 'Escape left the popover open');
	bar.openTagEditor();

	assert.equal(bar.state().tagDraftName, 'Docs', 'the abandoned name came back');
	assert.equal(bar.state().tagDraftColor, COLORS[1], 'the abandoned colour came back');
	assert.deepEqual(tabManager.windowTag, { name: 'Docs', color: COLORS[1], pinned: false });
});

// ------------------------------------------------------------------ the fences
//
// Each of these passes today and would also pass for a popover that simply
// closed on everything — which is what they are here to stop.

test('Enter still saves the draft', () => {
	const { bar } = setup();
	bar.openTagEditor();
	bar.setDraft('Notes', COLORS[3]);

	bar.editorKeydown({ key: 'Enter' });

	assert.equal(bar.state().tagEditorOpen, false);
	assert.deepEqual(tabManager.windowTag, { name: 'Notes', color: COLORS[3], pinned: false }, 'Enter stopped committing');
});

test('typing in the name field does not close the tag editor', () => {
	const { bar } = setup();
	bar.openTagEditor();

	for (const key of ['a', 'Backspace', 'Tab', 'ArrowLeft', ' ']) {
		bar.editorKeydown({ key });
		assert.equal(bar.state().tagEditorOpen, true, `\`${key}\` closed the popover`);
	}
});

test('clicks inside the tag editor do not dismiss it', () => {
	// Picking a colour is a click in the window like any other; without the
	// popover swallowing it, the dismissal added above would eat the editor
	// the moment the user chose a colour.
	const { bar, clickPath } = setup();
	bar.openTagEditor();

	clickPath(bar.editorClick);

	assert.equal(bar.state().tagEditorOpen, true, 'a click inside the popover dismissed it');
});

test('the window listeners exist only while something is open', () => {
	const { bar, listeners, flush } = setup();

	flush();
	assert.deepEqual([...listeners.keys()], [], 'listeners are installed with every popover closed');

	bar.openTagEditor();
	flush();
	assert.deepEqual([...listeners.keys()].sort(), ['blur', 'click', 'contextmenu']);

	// Every route the menus already used has to dismiss the tag editor too,
	// not just the click one asserted above.
	for (const type of ['blur', 'contextmenu']) {
		bar.openTagEditor();
		flush();
		listeners.get(type)!();
		assert.equal(bar.state().tagEditorOpen, false, `\`${type}\` did not dismiss the tag editor`);
	}

	flush();
	assert.deepEqual([...listeners.keys()], [], 'listeners outlived the last open popover');
});
