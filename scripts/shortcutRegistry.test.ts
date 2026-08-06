import assert from 'node:assert/strict';
import test from 'node:test';

import { getEditorToolbarTools } from '../src/lib/utils/editorToolbar.js';
import { getSupportedLanguages, t, translations, type LanguageCode, type Translation } from '../src/lib/utils/i18n.js';
import {
	SHORTCUTS,
	SHORTCUT_GROUPS,
	formatChord,
	shortcutLabel,
	shortcutSections,
	type ShortcutEntry,
} from '../src/lib/utils/shortcuts.js';
import { OperatingSystem, PLATFORMS, documentKeymap, editorKeymap, type Chord } from './keymapHarness.js';
import { readSource } from './sourceTree.js';

/*
 * THE CONTRACT: every chord the shortcuts panel shows is a chord that actually
 * fires, and it fires the command the panel says it does.
 *
 * A test that compared the registry against the panel would be worthless —
 * they are the same copy. So every row of `src/lib/utils/shortcuts.ts` is
 * checked against the code that implements it, using the same harness
 * `formatShortcutKeymap.test.ts` uses (`./keymapHarness.ts`): the editor's
 * actions are registered by really running `registerLocalizedActions`, and the
 * document-level chords are discovered by firing synthetic keystrokes at the
 * real `handleKeyDown`. Neither is a description of the handlers; both are the
 * handlers.
 *
 * The registry is a CLAIM about behaviour. This file is what stops the claim
 * drifting away from the behaviour.
 *
 * NOT ESTABLISHED HERE: that a running WebView delivers these chords. See the
 * note at the top of `keymapHarness.ts` — resolution order, `when` clauses and
 * the vim adapter all live in a browser.
 */

// ------------------------------------------------ registry chord -> Monaco label

/**
 * The key names Monaco's `KeyCodeUtils.toString` prints, where they differ from
 * the way the registry spells the key for a human.
 */
const MONACO_KEY_NAMES: Record<string, string> = {
	Left: 'LeftArrow',
	Right: 'RightArrow',
};

/**
 * A registry chord as the harness spells the same chord.
 *
 * The registry is written for a reader (`Mod+Shift+E`); Monaco's decoder emits
 * `Shift+Meta+E` on macOS and `Ctrl+Shift+E` elsewhere, in its own modifier
 * order. Translating in this direction — registry into harness — rather than
 * the other way keeps the registry human-facing, and a mistake here makes
 * assertions FAIL rather than pass, because the comparison is against chords
 * the real code produced.
 */
function toMonacoLabel(chord: string, mac: boolean): Chord {
	return chord
		.split(' ') // a chord SEQUENCE ("Mod+K T") is two chords
		.map((single) => {
			const parts = single.split('+');
			const key = parts.pop()!;
			const mods = new Set(parts);
			const ctrl = mods.has('Ctrl') || (mods.has('Mod') && !mac);
			const meta = mods.has('Mod') && mac;
			return [
				ctrl && 'Ctrl',
				mods.has('Shift') && 'Shift',
				mods.has('Alt') && 'Alt',
				meta && 'Meta',
				MONACO_KEY_NAMES[key] ?? key,
			]
				.filter(Boolean)
				.join('+');
		})
		.join(' ');
}

test('the chord translator agrees with the harness on chords both already know', () => {
	// If `toMonacoLabel` were broken every assertion below would fail, not pass —
	// but a silent disagreement about ONE key name would look like a real bug in
	// the app, so it is pinned against chords the editor layer independently
	// produces.
	const mac = editorKeymap(true, OperatingSystem.Macintosh);
	const win = editorKeymap(false, OperatingSystem.Windows);

	assert.equal(toMonacoLabel('Mod+Shift+E', true), 'Shift+Meta+E');
	assert.equal(toMonacoLabel('Mod+Shift+E', false), 'Ctrl+Shift+E');
	assert.equal(toMonacoLabel('Mod+K T', false), 'Ctrl+K T');
	assert.equal(toMonacoLabel('Ctrl+Tab', true), 'Ctrl+Tab', 'a literal Ctrl stays Ctrl on macOS');
	assert.equal(toMonacoLabel('Alt+Left', false), 'Alt+LeftArrow');

	assert.deepEqual(mac.get('fmt-inline-code'), ['Shift+Meta+E']);
	assert.deepEqual(win.get('insert-table-simple'), ['Ctrl+K T']);
});

// ------------------------------------------------------------- sanity guards

test('the registry was actually read, and is internally coherent', () => {
	// Every assertion below iterates SHORTCUTS. If it were empty — or if a filter
	// silently dropped everything — they would all pass having checked nothing.
	assert.ok(SHORTCUTS.length > 25, `the registry holds ${SHORTCUTS.length} entries`);

	const ids = SHORTCUTS.map((entry) => entry.id);
	assert.equal(new Set(ids).size, ids.length, 'shortcut ids are unique');

	for (const entry of SHORTCUTS) {
		assert.ok(entry.chords.length > 0, `${entry.id} declares at least one chord`);
		assert.ok(
			SHORTCUT_GROUPS.some((group) => group.group === entry.group),
			`${entry.id} is in a group the panel renders`,
		);
	}

	// Every entry reaches the panel: no row can be in the registry and invisible.
	const rendered = shortcutSections('macos').flatMap((section) => section.entries.map((e) => e.id));
	assert.deepEqual([...rendered].sort(), [...ids].sort());
});

test('no registry entry is unverifiable', () => {
	// The rule that makes this file mean something: a row must name the thing
	// that implements it, or it cannot be checked and must not be advertised.
	for (const entry of SHORTCUTS) {
		assert.ok(
			entry.editorAction || entry.documentCall || entry.nativeMenuAccelerator,
			`${entry.id} names no implementation, so nothing here can confirm its chord fires`,
		);
	}
});

test('no two entries advertise the same chord on the same platform', () => {
	// Two rows claiming one chord means at least one of them is a lie, and the
	// panel would print both with a straight face.
	for (const platform of PLATFORMS) {
		const owners = new Map<string, string[]>();
		for (const entry of SHORTCUTS) {
			for (const chord of entry.chords) {
				const key = toMonacoLabel(chord, platform.mac);
				owners.set(key, [...(owners.get(key) ?? []), entry.id]);
			}
		}
		for (const [chord, ids] of owners) {
			assert.equal(ids.length, 1, `${platform.name}: ${chord} is advertised by ${ids.join(' and ')}`);
		}
	}
});

// ------------------------------------------------------ the contract itself

test('every chord the registry advertises is the chord the editor really registers', () => {
	let checked = 0;
	for (const platform of PLATFORMS) {
		const keymap = editorKeymap(platform.mac, platform.os);
		for (const entry of SHORTCUTS) {
			if (!entry.editorAction) continue;
			const registered = keymap.get(entry.id);
			assert.ok(
				registered,
				`${platform.name}: the registry says ${entry.id} has a shortcut, but Editor.svelte registers no keybinding for that action id`,
			);
			for (const chord of entry.chords) {
				const want = toMonacoLabel(chord, platform.mac);
				assert.ok(
					registered.includes(want),
					`${platform.name}: the panel would show ${formatChord(chord, platform.mac ? 'Cmd' : 'Ctrl')} for ${entry.id}, but the editor binds it to ${registered.join(', ')}`,
				);
				checked++;
			}
		}
	}
	assert.ok(checked > 50, `only ${checked} editor chords were checked`);
});

test('every chord the registry advertises runs the command it names, outside the editor', () => {
	let checked = 0;
	for (const platform of PLATFORMS) {
		const keymap = documentKeymap(platform.osType);
		for (const entry of SHORTCUTS) {
			if (!entry.documentCall) continue;
			if (entry.documentExempt?.includes(platform.osType)) continue;
			for (const chord of entry.chords) {
				const want = toMonacoLabel(chord, platform.mac);
				const fired = keymap.get(want);
				assert.ok(
					fired,
					`${platform.name}: the panel would show ${formatChord(chord, platform.mac ? 'Cmd' : 'Ctrl')} for ${entry.id}, but that chord does nothing outside the editor`,
				);
				assert.ok(
					fired.some((call) => call.startsWith(entry.documentCall!)),
					`${platform.name}: ${want} is advertised as ${entry.id} (${entry.documentCall}) but runs ${fired.join(', ')}`,
				);
				checked++;
			}
		}
	}
	assert.ok(checked > 40, `only ${checked} document chords were checked`);
});

test('the native accelerator the registry defers to is the one the Rust menu claims', () => {
	// Quit is the one entry whose chord is answered neither by Monaco nor by the
	// document handler on macOS. Saying so in the registry is only honest if the
	// menu really does claim it.
	const rust = readSource('src-tauri/src/lib.rs');
	const accelerators = new Set([...rust.matchAll(/\.accelerator\("([^"]+)"\)/g)].map((m) => m[1]));
	assert.ok(accelerators.size > 0, 'the native menu accelerators were found');

	let checked = 0;
	for (const entry of SHORTCUTS) {
		if (!entry.nativeMenuAccelerator) continue;
		assert.ok(
			accelerators.has(entry.nativeMenuAccelerator),
			`${entry.id} defers to the native ${entry.nativeMenuAccelerator}, which the menu does not claim`,
		);
		checked++;
	}
	assert.equal(checked, 1, 'exactly one entry defers to the native menu');
});

test('zoom in raises the level, zoom out lowers it, and reset returns to the default', () => {
	// All three zoom chords work by assigning `zoomLevel`, so the contract test
	// above can only prove they reach the zoom code — not that + and − are the
	// right way round. The harness records the value written, which is what
	// tells them apart.
	for (const platform of PLATFORMS) {
		const keymap = documentKeymap(platform.osType);
		const modifier = platform.mac ? 'Meta' : 'Ctrl';
		const valueOf = (id: string): number => {
			const entry = SHORTCUTS.find((e) => e.id === id)!;
			const fired = keymap.get(toMonacoLabel(entry.chords[0], platform.mac));
			assert.ok(fired, `${id} answers on ${platform.name}`);
			const write = fired.find((call) => call.startsWith('zoomLevel='));
			assert.ok(write, `${id} writes zoomLevel on ${platform.name}; recorded ${fired.join(', ')}`);
			return Number(write.slice('zoomLevel='.length));
		};

		// The harness starts every chord from zoomLevel = 100.
		assert.ok(valueOf('view-zoom-in') > 100, `${modifier}+= zooms in on ${platform.name}`);
		assert.ok(valueOf('view-zoom-out') < 100, `${modifier}+- zooms out on ${platform.name}`);
		assert.equal(valueOf('view-zoom-reset'), 100, `${modifier}+0 resets zoom on ${platform.name}`);
	}
});

// ------------------------------------------------------ the display layers

test('the editor toolbar declares no chord of its own', () => {
	// NOT "the toolbar hint equals the registry", which is what stood here first:
	// once `editorToolbar.ts` derives its hints from `shortcuts.ts`, both sides of
	// that comparison are the same copy and the assertion cannot fail. Deleting a
	// registry row left it green.
	//
	// The toolbar-vs-reality link is held where it belongs — by
	// `formatShortcutKeymap.test.ts`, which compares the rendered hint against the
	// keybinding `Editor.svelte` really registers — and by the coverage test
	// below, which is what caught the deleted row. What is left for this file is
	// the migration itself: the fourteen hand-written chords are gone and cannot
	// come back unnoticed.
	const source = readSource('src/lib/utils/editorToolbar.ts');
	const literals = [...source.matchAll(/`\$\{modifier\}\+[^`]*`/g)].map((m) => m[0]);
	assert.deepEqual(literals, [], 'a chord literal is back in editorToolbar.ts; it belongs in shortcuts.ts');

	// And the hints still render, so "no literals" was not achieved by dropping
	// the feature.
	const tools = getEditorToolbarTools(null);
	assert.ok(tools.length > 10, `found ${tools.length} toolbar tools`);
	const hinted = tools.filter((tool) => tool.shortcut);
	assert.ok(hinted.length >= 10, `only ${hinted.length} toolbar buttons show a shortcut`);
	assert.equal(getEditorToolbarTools(null).find((t) => t.id === 'fmt-bold')?.shortcut?.('Cmd'), 'Cmd+B');
});

test('the app menu prints no shortcut literal of its own', () => {
	// The fourteen hard-coded `<span class="menu-shortcut">{modifier}+T</span>`
	// literals are what this change exists to delete. This is a structural
	// assertion — it cannot see whether the chord is RIGHT, which is what every
	// test above is for — but it is what stops a fifteenth being added by hand.
	const titleBar = readSource('src/lib/components/TitleBar.svelte');
	const spans = [...titleBar.matchAll(/<span class="menu-shortcut">([\s\S]*?)<\/span>/g)].map((m) => m[1].trim());
	assert.ok(spans.length > 10, `found ${spans.length} menu-shortcut spans`);

	const literals = spans.filter((body) => !body.startsWith('{'));
	assert.deepEqual(literals, [], 'every menu shortcut is an expression, not a hard-coded chord');

	// …and specifically, an expression that goes through the registry. The zoom
	// reset button reuses the class for the word "Reset", which is a label rather
	// than a chord.
	const offRegistry = spans.filter((body) => !body.includes('shortcutLabel(') && !body.includes("t('tooltip.reset'"));
	assert.deepEqual(offRegistry, [], 'every menu chord comes from shortcutLabel()');
});

test('the app menu shows the chord for a command the registry can still not verify', () => {
	// Save As. The menu used to print `Mod+Shift+S` beside it; nothing binds that
	// chord. Because the save branch does not exclude Shift, the advertised
	// keystroke ran a plain Save — silently writing the current file instead of
	// asking where to put it. The registry has no Save As row, so the menu now
	// prints no chord there, and this pins the reason.
	for (const platform of PLATFORMS) {
		const keymap = documentKeymap(platform.osType);
		const shiftS = platform.mac ? 'Shift+Meta+S' : 'Ctrl+Shift+S';
		const fired = keymap.get(shiftS) ?? [];
		assert.ok(
			!fired.some((call) => call.startsWith('saveContentAs')),
			`${shiftS} now reaches saveContentAs on ${platform.name} — give Save As a registry row`,
		);
	}
	assert.equal(SHORTCUTS.find((entry) => entry.labelKey === 'menu.saveAs'), undefined);
});

// -------------------------------------------------- editor bindings vs panel

/**
 * Editor actions that carry a keybinding and are deliberately NOT advertised.
 *
 * Without this list the registry could quietly fall behind: someone binds a new
 * chord, the panel never mentions it, and no test notices. Each exclusion is a
 * decision with a reason, in the shape this repo already uses for
 * `KNOWN_LAYER_DIVERGENCES` and `KNOWN_ORPHANS`.
 */
const NOT_ADVERTISED: Record<string, string> = {
	'custom-copy':
		'the OS clipboard convention, not an app shortcut; its Ctrl+V twin is a bare addCommand with no id, so listing one without the other is the more confusing half-answer',
};

test('every keybinding the editor registers is either advertised or consciously not', () => {
	const advertised = new Set(SHORTCUTS.filter((entry) => entry.editorAction).map((entry) => entry.id));
	const bound = [...editorKeymap(false, OperatingSystem.Windows).keys()];
	assert.ok(bound.length > 20, `the editor binds ${bound.length} actions`);

	const unexplained = bound.filter((id) => !advertised.has(id) && !(id in NOT_ADVERTISED));
	assert.deepEqual(
		unexplained,
		[],
		'these editor actions have a keybinding that the shortcuts panel never mentions; ' +
			'add a row to SHORTCUTS or a reason to NOT_ADVERTISED',
	);

	// The exclusion list must not rot: a binding that went away has to leave it.
	for (const id of Object.keys(NOT_ADVERTISED)) {
		assert.ok(bound.includes(id), `${id} no longer has a keybinding — drop it from NOT_ADVERTISED`);
	}
});

// ------------------------------------------------------------------- i18n

test('every label the registry names is a key English already defines', () => {
	// The registry deliberately mints no new command names: each label is a key
	// that already existed for a menu or context-menu entry, and is therefore
	// already translated everywhere. This is the assertion that keeps it that
	// way — a new key would have to be added to the dictionary first.
	const labelKeys = [...SHORTCUTS.map((e) => e.labelKey), ...SHORTCUT_GROUPS.map((g) => g.labelKey)];
	assert.ok(labelKeys.length > 30, `checking ${labelKeys.length} label keys`);

	for (const key of labelKeys) {
		assert.notEqual(t(key, 'en'), key, `${key} is defined in English`);
		assert.ok(t(key, 'en').length > 0, `${key} is non-empty in English`);
	}
});

/** The value `lang` itself defines for `key`, ignoring the English fallback. */
function defines(lang: LanguageCode, key: string): boolean {
	let node: string | Translation | undefined = translations[lang];
	for (const part of key.split('.')) {
		if (typeof node !== 'object' || node === null || !(part in node)) return false;
		node = node[part];
	}
	return typeof node === 'string';
}

/**
 * Registry labels that are NOT translated in every locale.
 *
 * Reusing existing keys bought full 26-locale coverage for 31 of the 38 labels
 * the panel needs. It did not buy it for these seven — and pretending otherwise
 * was the first thing this test caught. Every one of them is a key the app menu
 * ALREADY renders today (Reload from Disk, Find…, Back, Forward, Open File
 * Location, Move to, Window), so the panel inherits an existing gap rather than
 * creating one, and `t()` falls back to English exactly as the menu does.
 *
 * Pinned rather than waived: a new under-translated label fails the test below,
 * and a key that gets translated has to leave this list.
 */
const PARTIALLY_TRANSLATED: Record<string, number> = {
	'menu.reloadFromDisk': 22,
	'menu.openFileLocation': 21,
	'menu.find': 22,
	'menu.moveToWindow': 23,
	'menu.back': 21,
	'menu.forward': 21,
	'menu.window': 23,
};

test('every panel label is translated everywhere, or is a named pre-existing gap', () => {
	// The stated reason for reusing dictionary keys instead of minting new ones
	// was that the existing ones are already translated. That is a claim about
	// the dictionary, so it is measured here rather than asserted from memory.
	const languages = getSupportedLanguages().map((l) => l.code) as LanguageCode[];
	assert.equal(languages.length, 26);

	const measured = new Map<string, number>();
	for (const key of new Set([...SHORTCUTS.map((e) => e.labelKey), ...SHORTCUT_GROUPS.map((g) => g.labelKey)])) {
		const missing = languages.filter((lang) => !defines(lang, key)).length;
		if (missing > 0) measured.set(key, missing);
	}

	assert.deepEqual(
		Object.fromEntries([...measured].sort()),
		Object.fromEntries(Object.entries(PARTIALLY_TRANSLATED).sort()),
		'a panel label’s translation coverage changed; if a key was newly introduced or ' +
			'newly translated, update PARTIALLY_TRANSLATED — do not let the panel quietly ' +
			'grow labels that 20-odd locales cannot read',
	);
});

test('no two rows in one panel section read the same, in any language', () => {
	// Two rows with one label is indistinguishable from a duplicated entry from
	// the user's side — the defect `editorContextMenuI18n.test.ts` calls ED-6.
	const languages = getSupportedLanguages().map((l) => l.code) as LanguageCode[];
	for (const { group } of SHORTCUT_GROUPS) {
		const rows = SHORTCUTS.filter((entry: ShortcutEntry) => entry.group === group);
		for (const lang of languages) {
			const seen = new Map<string, string>();
			for (const row of rows) {
				const text = t(row.labelKey, lang);
				const owner = seen.get(text);
				assert.equal(owner, undefined, `${lang} ${group}: ${owner} and ${row.id} both read "${text}"`);
				seen.set(text, row.id);
			}
		}
	}
});

test('the panel renders the platform modifier the user is on', () => {
	const mac = shortcutSections('macos').flatMap((s) => s.entries);
	const win = shortcutSections('windows').flatMap((s) => s.entries);

	assert.equal(mac.find((e) => e.id === 'fmt-bold')?.chords[0], 'Cmd+B');
	assert.equal(win.find((e) => e.id === 'fmt-bold')?.chords[0], 'Ctrl+B');
	// A literal Ctrl is not a Mod: tab cycling is Ctrl+Tab on macOS too.
	assert.equal(mac.find((e) => e.id === 'tab-next')?.chords[0], 'Ctrl+Tab');
	// F5 has no modifier at all.
	assert.equal(mac.find((e) => e.id === 'file-reload')?.chords[0], 'F5');

	assert.equal(shortcutLabel('fmt-quote', 'Cmd'), 'Cmd+Shift+.');
	assert.equal(shortcutLabel('no-such-command', 'Cmd'), undefined);
});
