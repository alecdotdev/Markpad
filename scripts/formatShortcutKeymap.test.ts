import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeKeybinding, type KeyCodeChord } from 'monaco-editor/esm/vs/base/common/keybindings.js';
import { KeyCodeUtils } from 'monaco-editor/esm/vs/base/common/keyCodes.js';
import { KeyCode } from 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js';
import { KeyMod } from 'monaco-editor/esm/vs/editor/common/services/editorBaseApi.js';
import ts from 'typescript';

import { getEditorToolbarTools } from '../src/lib/utils/editorToolbar.js';
import { readSource, functionSource } from './sourceTree.js';

/*
 * Issues #121 (six formatting commands with no shortcut) and #392 (Ctrl+T means
 * two things). Both needed the same thing first — the whole keymap — so they are
 * held by one file.
 *
 * WHAT THIS FILE EXECUTES
 *
 * `registerLocalizedActions` and `handleKeyDown` are lifted out of their Svelte
 * components and RUN. The keybinding numbers come from Monaco's real `KeyMod`
 * and `KeyCode`, and they are turned back into chords by Monaco's real
 * `decodeKeybinding`, once per operating system. Nothing below matches the
 * component as text, so renaming a local, reordering the actions or rewriting
 * the branch structure changes nothing here; changing a KEY does.
 *
 * The document-level layer is discovered by firing a synthetic keystroke for
 * every chord in a bounded space and recording which app function ran. That is
 * why "Ctrl+T does not open a Home tab" is an assertion about what the handler
 * DOES rather than about which identifier appears next to `key === 't'`.
 *
 * WHAT IT DOES NOT ESTABLISH
 *
 * - That Monaco delivers these chords at runtime. Resolution order, the `when`
 *   clauses and the vim adapter all live in a browser. What is pinned here is
 *   the keymap the app declares.
 * - Layout-dependent `key` values. The synthetic events carry the UNSHIFTED
 *   character (`key: ','`, not `'<'`), because that is the only value that is
 *   the same on every keyboard layout. Two of the app's document-level branches
 *   compare `e.key` against punctuation and are therefore modelled, not
 *   reproduced: `Ctrl+,` (settings) and `Ctrl+=`/`Ctrl+-` (zoom).
 * - Whether a chord is free in standalone MONACO. That needs Monaco's whole
 *   browser-side contribution graph to evaluate, which needs a DOM. The
 *   snapshot in MONACO_DEFAULTS below is the weaker form, and it is labelled as
 *   such where it is used.
 */

// --------------------------------------------------------------- chord labels

type Chord = string;

/**
 * `OperatingSystem` is a TypeScript `const enum` in Monaco, so the shipped ESM
 * has the numbers inlined and exports no symbol to import. The values are the
 * ones `vs/base/common/platform.js` inlines when it computes its own `OS`.
 */
const OperatingSystem = { Windows: 1, Macintosh: 2, Linux: 3 } as const;

type OperatingSystemValue = (typeof OperatingSystem)[keyof typeof OperatingSystem];

const MODIFIER_ORDER = ['Ctrl', 'Shift', 'Alt', 'Meta'] as const;

function label(parts: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; keyCode: number }): string {
	const mods = [
		parts.ctrlKey && 'Ctrl',
		parts.shiftKey && 'Shift',
		parts.altKey && 'Alt',
		parts.metaKey && 'Meta',
	].filter(Boolean) as Array<(typeof MODIFIER_ORDER)[number]>;
	return [...MODIFIER_ORDER.filter((m) => mods.includes(m)), KeyCodeUtils.toString(parts.keyCode)].join('+');
}

/** A Monaco keybinding number, as the chord (or chord sequence) Monaco resolves it to. */
function chordOf(binding: number, os: OperatingSystemValue): Chord {
	const decoded = decodeKeybinding(binding, os);
	assert.ok(decoded, `Monaco could not decode keybinding ${binding}`);
	return decoded.chords.map((chord) => label(chord as KeyCodeChord)).join(' ');
}

const PLATFORMS = [
	{ name: 'macOS', os: OperatingSystem.Macintosh, osType: 'macos', mac: true },
	{ name: 'Windows', os: OperatingSystem.Windows, osType: 'windows', mac: false },
	{ name: 'Linux', os: OperatingSystem.Linux, osType: 'linux', mac: false },
] as const;

// ------------------------------------------------- the editor (Monaco) layer

type ActionDescriptor = { id: string; label: string; keybindings?: number[]; run: (ed?: unknown) => unknown };

/**
 * Every action `registerLocalizedActions` registers, for one platform.
 *
 * The function is extracted by name (not by a `sliceBetween` anchor pair, which
 * widens as neighbours are added) and evaluated inside a `with` block whose
 * scope object answers for EVERY free identifier. A dependency the function
 * grows later resolves to a recording stub instead of a ReferenceError, so this
 * harness does not have to be edited every time the component gains a callback
 * — and a stub cannot fake a keybinding, because the keybinding numbers come
 * from the real `KeyMod`/`KeyCode` handed in below.
 */
function registeredActions(mac: boolean): { actions: ActionDescriptor[]; calls: string[] } {
	const source = functionSource(readSource('src/lib/components/Editor.svelte'), 'registerLocalizedActions');
	const js = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
	}).outputText;

	const actions: ActionDescriptor[] = [];
	const calls: string[] = [];
	const record = (name: string) =>
		(...args: unknown[]) => {
			calls.push(args.length ? `${name}(${args.map((a) => JSON.stringify(a)).join(',')})` : name);
			return undefined;
		};

	const known: Record<string, unknown> = {
		monaco: { KeyMod, KeyCode },
		editor: {
			addAction(descriptor: ActionDescriptor) {
				actions.push(descriptor);
				return { dispose() {} };
			},
			getSelection: () => null,
			executeEdits: record('executeEdits'),
			trigger: record('trigger'),
		},
		isMacPlatform: () => mac,
		// `t` is not the real translator on purpose: this file asserts about
		// keys, and editorContextMenuI18n.test.ts already asserts that every one
		// of these labels comes from the dictionary.
		t: (key: string) => key,
		localizedActions: [],
		disposeLocalizedActions: () => {},
	};

	const scope = new Proxy(known, {
		has: () => true,
		get: (target, property) => {
			if (typeof property !== 'string') return undefined;
			if (property in target) return target[property];
			const stub = record(property);
			// Callbacks are read as `onnew?.()` and settings as
			// `settings.toggleMinimap()`, so the stub has to be callable AND
			// indexable.
			return new Proxy(stub, { get: (fn, key) => (key in fn ? (fn as never)[key] : record(`${property}.${String(key)}`)) });
		},
	});

	const build = new Function('scope', `with (scope) { ${js}\nreturn registerLocalizedActions; }`) as (
		s: unknown,
	) => (lang: string) => void;
	build(scope)('en');

	assert.ok(actions.length > 20, `registerLocalizedActions registered ${actions.length} actions; the harness is not running the real function`);
	return { actions, calls };
}

/** actionId -> chord, for the actions that declare one. */
function editorKeymap(mac: boolean, os: OperatingSystemValue): Map<string, Chord[]> {
	const map = new Map<string, Chord[]>();
	for (const action of registeredActions(mac).actions) {
		if (!action.keybindings?.length) continue;
		map.set(action.id, action.keybindings.map((binding) => chordOf(binding, os)));
	}
	return map;
}

// ----------------------------------------------- the document (window) layer

/**
 * The keys the document-level handler is fired with.
 *
 * `key` is the unshifted character and `code` the physical key, which is what a
 * US layout reports and what every layout reports for letters and digits.
 */
const FUZZ_KEYS: Array<{ keyCode: number; key: string; code: string }> = [
	...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => ({
		keyCode: KeyCode.KeyA + (c.charCodeAt(0) - 97),
		key: c,
		code: `Key${c.toUpperCase()}`,
	})),
	...'0123456789'.split('').map((c) => ({
		keyCode: KeyCode.Digit0 + (c.charCodeAt(0) - 48),
		key: c,
		code: `Digit${c}`,
	})),
	{ keyCode: KeyCode.Tab, key: 'Tab', code: 'Tab' },
	{ keyCode: KeyCode.PageUp, key: 'PageUp', code: 'PageUp' },
	{ keyCode: KeyCode.PageDown, key: 'PageDown', code: 'PageDown' },
	{ keyCode: KeyCode.LeftArrow, key: 'ArrowLeft', code: 'ArrowLeft' },
	{ keyCode: KeyCode.RightArrow, key: 'ArrowRight', code: 'ArrowRight' },
	{ keyCode: KeyCode.F4, key: 'F4', code: 'F4' },
	{ keyCode: KeyCode.F5, key: 'F5', code: 'F5' },
	{ keyCode: KeyCode.Backslash, key: '\\', code: 'Backslash' },
	{ keyCode: KeyCode.IntlBackslash, key: '\\', code: 'IntlBackslash' },
	{ keyCode: KeyCode.BracketLeft, key: '[', code: 'BracketLeft' },
	{ keyCode: KeyCode.BracketRight, key: ']', code: 'BracketRight' },
	{ keyCode: KeyCode.Period, key: '.', code: 'Period' },
	{ keyCode: KeyCode.Comma, key: ',', code: 'Comma' },
	{ keyCode: KeyCode.Minus, key: '-', code: 'Minus' },
	{ keyCode: KeyCode.Equal, key: '=', code: 'Equal' },
];

/**
 * Which app functions the document-level handler runs for each chord.
 *
 * The handler is extracted and evaluated the same way as the editor's action
 * list, then fired once per chord. Everything it can reach — `tabManager`,
 * `saveContent`, `handleNewFile` — is a recording stub, so what comes back is
 * the handler's real branch structure rather than a description of it.
 */
function documentKeymap(osType: string): Map<Chord, string[]> {
	const source = functionSource(readSource('src/lib/MarkdownViewer.svelte'), 'handleKeyDown');
	const js = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
	}).outputText;

	let fired: string[] = [];
	/**
	 * A stub that is callable, indexable and self-similar, so
	 * `getCurrentWindow().close()` and `tabManager.cycleTab('next')` both work
	 * without the harness having to know they exist. Every call is recorded
	 * under its full path, which is what the assertions read.
	 */
	const record = (name: string): never => {
		const fn = (...args: unknown[]) => {
			fired.push(args.length && typeof args[0] === 'string' ? `${name}:${args[0]}` : name);
			return record(`${name}()`);
		};
		return new Proxy(fn, {
			get: (target, key) =>
				typeof key === 'string' && !(key in target) ? record(`${name}.${key}`) : (target as never)[key as never],
		}) as never;
	};

	const known: Record<string, unknown> = {
		mode: 'app',
		settings: new Proxy({ osType }, { get: (t, k) => (k === 'osType' ? osType : record(`settings.${String(k)}`)) }),
		showSettings: false,
		showHome: false,
		isEditing: false,
		modalState: { show: false },
		promptModal: { show: false },
		zoomLevel: 100,
		isFullWidth: false,
		editorPaneEl: null,
		document: { activeElement: null },
		tabManager: new Proxy(
			{ activeTab: { isSplit: false, isDirty: true, path: '/x.md' }, activeTabId: 'tab-1' },
			{ get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : record(`tabManager.${String(k)}`)) },
		),
		canUsePreviewWidthShortcut: () => true,
		adjustPreviewMaxWidth: () => 800,
	};

	const scope = new Proxy(known, {
		has: () => true,
		get: (target, property) => {
			if (typeof property !== 'string') return undefined;
			if (property in target) return target[property];
			return record(property);
		},
		set: () => true,
	});

	const build = new Function('scope', `with (scope) { ${js}\nreturn handleKeyDown; }`) as (
		s: unknown,
	) => (e: unknown) => void;
	const handler = build(scope);

	const map = new Map<Chord, string[]>();
	for (const primary of [
		{ ctrlKey: false, metaKey: false },
		{ ctrlKey: true, metaKey: false },
		{ ctrlKey: false, metaKey: true },
	]) {
		for (const shiftKey of [false, true]) {
			for (const altKey of [false, true]) {
				for (const entry of FUZZ_KEYS) {
					fired = [];
					handler({
						...primary,
						shiftKey,
						altKey,
						key: entry.key,
						code: entry.code,
						target: null,
						preventDefault: () => {},
					});
					if (fired.length === 0) continue;
					map.set(label({ ...primary, shiftKey, altKey, keyCode: entry.keyCode }), [...new Set(fired)]);
				}
			}
		}
	}
	assert.ok(map.size > 15, `the document handler answered ${map.size} chords; the harness is not running the real function`);
	return map;
}

// ------------------------------------------------------------------ item #121

/**
 * The six bindings this change adds, and the chord each must resolve to.
 *
 * `CtrlCmd` resolves to Meta on macOS and Ctrl everywhere else, so each row is
 * checked against Monaco's decoder once per platform rather than assumed.
 */
const NEW_BINDINGS: ReadonlyArray<[actionId: string, mac: Chord, other: Chord, toolbarLabel: string]> = [
	['fmt-heading-1', 'Meta+1', 'Ctrl+1', '+1'],
	['fmt-heading-2', 'Meta+2', 'Ctrl+2', '+2'],
	['fmt-heading-3', 'Meta+3', 'Ctrl+3', '+3'],
	['fmt-inline-code', 'Shift+Meta+E', 'Ctrl+Shift+E', '+Shift+E'],
	['fmt-code-block', 'Shift+Meta+F', 'Ctrl+Shift+F', '+Shift+F'],
	['fmt-quote', 'Shift+Meta+.', 'Ctrl+Shift+.', '+Shift+.'],
];

test('each formatting action asked for in #121 now carries its shortcut', () => {
	for (const platform of PLATFORMS) {
		const keymap = editorKeymap(platform.mac, platform.os);
		for (const [id, mac, other] of NEW_BINDINGS) {
			assert.deepEqual(
				keymap.get(id),
				[platform.mac ? mac : other],
				`${id} on ${platform.name}`,
			);
		}
	}
});

test('each new shortcut runs the command it is labelled with', () => {
	// The binding and the body are two separate fields of one object literal,
	// and nothing in the type system stops `fmt-heading-2` from carrying
	// heading 3's `run`. Each action is invoked and the call it makes recorded.
	const expected: Record<string, string> = {
		'fmt-heading-1': 'toggleLineMarkerTool("fmt-heading-1")',
		'fmt-heading-2': 'toggleLineMarkerTool("fmt-heading-2")',
		'fmt-heading-3': 'toggleLineMarkerTool("fmt-heading-3")',
		'fmt-quote': 'toggleLineMarkerTool("fmt-quote")',
		'fmt-inline-code': 'toggleFormat("`")',
		'fmt-code-block': 'wrapAsCodeBlock',
	};

	const { actions, calls } = registeredActions(false);
	for (const [id, want] of Object.entries(expected)) {
		const action = actions.find((a) => a.id === id);
		assert.ok(action, `${id} is registered`);
		const before = calls.length;
		action.run();
		assert.deepEqual(calls.slice(before), [want], `${id} runs ${want}`);
	}
});

test('the toolbar tooltip prints the shortcut the editor actually registered', () => {
	// Two copies of one fact: Editor.svelte binds the key, editorToolbar.ts
	// renders the hint on the button. Bold, Italic and Underline already had
	// both and nothing held them together.
	const byId = new Map(getEditorToolbarTools(null).map((tool) => [tool.id, tool]));
	const bound = editorKeymap(false, OperatingSystem.Windows);

	for (const [id, tool] of byId) {
		const chords = bound.get(id);
		if (!chords) {
			assert.equal(tool.shortcut, undefined, `${id} has no keybinding, so the toolbar must not advertise one`);
			continue;
		}
		assert.ok(tool.shortcut, `${id} is bound to ${chords.join(' ')} but the toolbar shows nothing`);
		// "Ctrl+Shift+E" -> "Ctrl+Shift+E"; a chord sequence "Ctrl+K T" -> "Ctrl+K T".
		assert.equal(
			tool.shortcut('Ctrl'),
			chords[0].replace(/\bMeta\b/g, 'Ctrl'),
			`${id}: toolbar hint and registered keybinding disagree`,
		);
		assert.equal(tool.shortcut('Cmd'), tool.shortcut('Ctrl').replace('Ctrl', 'Cmd'));
	}

	// The rows this change adds, spelled out, so that deleting one of them from
	// editorToolbar.ts fails here rather than passing the loop above vacuously.
	for (const [id, , , suffix] of NEW_BINDINGS) {
		assert.equal(byId.get(id)?.shortcut?.('Cmd'), `Cmd${suffix}`, `${id} toolbar hint`);
	}
});

// ------------------------------------------------------------------ item #392

const NEW_FILE_CHORDS = { mac: ['Meta+N', 'Meta+T'], other: ['Ctrl+N', 'Ctrl+T'] };

test('Ctrl/Cmd+T means new file in the editor, on every platform', () => {
	for (const platform of PLATFORMS) {
		const chords = editorKeymap(platform.mac, platform.os).get('file-new');
		assert.deepEqual(
			chords,
			platform.mac ? NEW_FILE_CHORDS.mac : NEW_FILE_CHORDS.other,
			`file-new on ${platform.name}`,
		);
	}

	// `onnew` is the prop MarkdownViewer.svelte binds to `handleNewFile`, which
	// is the same function the document-level branch calls after this change.
	const probe = registeredActions(false);
	const fileNew = probe.actions.find((action) => action.id === 'file-new');
	assert.ok(fileNew, 'file-new is registered');
	const before = probe.calls.length;
	fileNew.run();
	assert.deepEqual(probe.calls.slice(before), ['onnew'], 'file-new calls the onnew prop');

	assert.match(
		readSource('src/lib/MarkdownViewer.svelte'),
		/onnew=\{handleNewFile\}/,
		'the editor prop is wired to handleNewFile',
	);
});

test('Ctrl/Cmd+T means new file outside the editor too, on every platform', () => {
	// This is #392. Before the fix the document-level handler answered the same
	// chord with `tabManager.addHomeTab`, so the meaning of Ctrl+T depended on
	// where the caret was — Monaco consumes the keystroke and stops it
	// propagating only when it is the editor that has focus.
	for (const platform of PLATFORMS) {
		const keymap = documentKeymap(platform.osType);
		for (const chord of platform.mac ? ['Meta+T', 'Meta+N'] : ['Ctrl+T', 'Ctrl+N']) {
			assert.deepEqual(
				keymap.get(chord),
				['handleNewFile'],
				`${chord} on ${platform.name} opens a new file and nothing else`,
			);
		}
	}
});

test('no path anywhere still opens a Home tab from a keystroke', () => {
	for (const platform of PLATFORMS) {
		for (const [chord, fired] of documentKeymap(platform.osType)) {
			assert.ok(
				!fired.some((call) => call.includes('addHomeTab')),
				`${chord} on ${platform.name} still reaches addHomeTab`,
			);
		}
	}
});

test('the native macOS menu claims exactly two accelerators, and T is not one', () => {
	// The third code path in #392. The menu was trimmed to Settings and Quit
	// (#281); anything added back that takes Cmd+T would reintroduce a fourth
	// meaning, above both layers above, and neither of them could see it.
	const rust = readSource('src-tauri/src/lib.rs');
	const accelerators = [...rust.matchAll(/\.accelerator\("([^"]+)"\)/g)].map((m) => m[1]).sort();
	assert.deepEqual(accelerators, ['CmdOrCtrl+,', 'CmdOrCtrl+Q']);
});

// ---------------------------------------------------------- the whole keymap

test('no two editor actions claim the same chord', () => {
	for (const platform of PLATFORMS) {
		const owners = new Map<Chord, string[]>();
		for (const [id, chords] of editorKeymap(platform.mac, platform.os)) {
			for (const chord of chords) owners.set(chord, [...(owners.get(chord) ?? []), id]);
		}
		for (const [chord, ids] of owners) {
			assert.equal(ids.length, 1, `${platform.name}: ${chord} is claimed by ${ids.join(' and ')}`);
		}
	}
});

/**
 * Chords the two layers answer differently, on purpose or not.
 *
 * A chord that both Monaco and the document handler answer must mean the same
 * thing in both, or it means two things depending on focus — which is exactly
 * what #392 reported. Everything left here is a divergence that predates this
 * change; each is named so that a NEW one fails instead of joining a silent
 * pile.
 */
const KNOWN_LAYER_DIVERGENCES: Record<Chord, string> = {
	// Monaco binds real Ctrl+Tab on macOS because Cmd+Tab is the system app
	// switcher (see editorOptionWiring.test.ts); the document handler accepts
	// either modifier. Same action, different chord — not a meaning conflict.
	'Ctrl+Tab': 'tab cycling: Monaco uses WinCtrl on macOS, the window handler accepts Ctrl or Cmd',
	'Ctrl+Shift+Tab': 'tab cycling, as above',
	'Meta+Tab': 'tab cycling, as above',
	'Shift+Meta+Tab': 'tab cycling, as above',
};

test('a chord that both layers answer means the same thing in both', () => {
	// The pairs the app deliberately mirrors: the editor action and the
	// window-level branch that stands in for it when the caret is elsewhere.
	const MIRROR: Record<string, string> = {
		'file-new': 'handleNewFile',
		'file-open': 'selectFile',
		'file-save': 'saveContent',
		'file-close': 'closeFile',
		'view-toggle-edit': 'toggleEdit',
		'view-toggle-split': 'toggleSplitView',
		'tab-undo-close': 'handleUndoCloseTab',
	};

	for (const platform of PLATFORMS) {
		const editorSide = editorKeymap(platform.mac, platform.os);
		const documentSide = documentKeymap(platform.osType);

		for (const [id, expectedCall] of Object.entries(MIRROR)) {
			const chords = editorSide.get(id);
			assert.ok(chords?.length, `${id} is bound in the editor on ${platform.name}`);
			for (const chord of chords) {
				if (chord in KNOWN_LAYER_DIVERGENCES) continue;
				const fired = documentSide.get(chord);
				assert.ok(fired, `${platform.name}: ${chord} runs ${id} in the editor but nothing outside it`);
				assert.ok(
					fired.some((call) => call.startsWith(expectedCall)),
					`${platform.name}: ${chord} runs ${id} in the editor but ${fired.join(', ')} outside it`,
				);
			}
		}
	}
});

/**
 * Standalone Monaco's own defaults for the chords this change considered.
 *
 * A SNAPSHOT, and the weakest assertion in this file — it is a copy of what
 * Monaco 0.55 registers, not a reading of it. Enumerating them for real means
 * evaluating `monaco-editor`'s browser-side contribution graph, which needs a
 * DOM the Node test runner does not have; a shim large enough to load it would
 * be a second, synthetic source of truth for exactly the thing being checked.
 *
 * Regenerate against the installed package (not against VS Code's documentation
 * — the two keymaps are NOT the same, which is how Ctrl+Shift+K got proposed
 * for a code block) by loading `monaco-editor` under a DOM shim and dumping
 * `KeybindingsRegistry.getDefaultKeybindings()` once per `process.platform`.
 */
const MONACO_DEFAULTS: Record<Chord, string> = {
	'Ctrl+Shift+K': 'editor.action.deleteLines',
	'Shift+Meta+K': 'editor.action.deleteLines',
	'Alt+Meta+C': 'toggleFindCaseSensitive',
	'Ctrl+Shift+L': 'editor.action.selectHighlights',
	'Shift+Meta+L': 'editor.action.selectHighlights',
	'Ctrl+Shift+O': 'editor.action.quickOutline',
	'Shift+Meta+O': 'editor.action.quickOutline',
	'Ctrl+Shift+1': 'editor.action.replaceOne',
	'Shift+Meta+1': 'editor.action.replaceOne',
	'Ctrl+Shift+,': 'editor.action.inPlaceReplace.up',
	'Shift+Meta+,': 'editor.action.inPlaceReplace.up',
};

test('the shortcuts added for #121 avoid the Monaco defaults they were checked against', () => {
	for (const platform of PLATFORMS) {
		for (const [id, mac, other] of NEW_BINDINGS) {
			const chord = platform.mac ? mac : other;
			assert.ok(
				!(chord in MONACO_DEFAULTS),
				`${id} takes ${chord} on ${platform.name}, which is Monaco's ${MONACO_DEFAULTS[chord]}`,
			);
		}
	}

	// The one deliberate exception, stated rather than left implicit: Quote
	// takes Ctrl/Cmd+Shift+. — GitHub's blockquote chord — from Monaco's
	// `inPlaceReplace.down`, which stays reachable from the command palette.
	// Its sibling `inPlaceReplace.up` is listed above precisely so that moving
	// Quote onto Ctrl+Shift+, would fail this test instead of silently taking
	// the other half.
	assert.equal(MONACO_DEFAULTS['Ctrl+Shift+.'], undefined);
});
